// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  ProductWarrantyRegistry
 * @author COMP5565 Group Project
 * @notice On-chain registry for the provenance (chain of custody) and the warranty of
 *         physical products, driven by four explicit supply-chain roles.
 *
 * The contract models the standard life of a durable good:
 *
 *     Manufacturer --> Retailer --> Customer --> (secondary resale) --> Customer #2
 *
 * Every hand-over is appended to an immutable, per-product ownership history, so any
 * party can independently verify where a unit came from and who owns it today.
 *
 * Roles (OpenZeppelin `AccessControl`)
 * ------------------------------------
 * - `DEFAULT_ADMIN_ROLE`  : registry operator, grants / revokes the roles below.
 * - `MANUFACTURER_ROLE`   : `registerProduct`, `transferToRetailer`, `voidWarranty`, `recallProduct`.
 * - `RETAILER_ROLE`       : `transferToCustomer` (retail sale).
 * - `CUSTOMER_ROLE`       : `transferOwnership` (secondary resale), `submitWarrantyClaim`.
 * - `SERVICE_CENTER_ROLE` : `resolveWarrantyClaim`.
 *
 * Design notes
 * ------------
 * - `productId` is a sequential `uint256` assigned by the contract and used as the primary
 *   key. The manufacturer supplied `serialNumber` is hashed and mapped to it, so a serial
 *   number can only ever be registered once while the readable serial stays in the struct.
 * - The chain of custody and the warranty claims live in dedicated mappings instead of
 *   arrays inside `Product`, so reading a product never pays for its whole history.
 * - Warranty expiry is *derived* from the block timestamp and the claim counter
 *   (`getWarrantyStatus` / `isWarrantyActive`), so a warranty can never look active just
 *   because nobody poked the contract. The stored `Warranty.status` is synced lazily by
 *   `_syncWarrantyStatus` on every state changing interaction (and can be poked by anyone
 *   through `syncWarrantyStatus`), which is when `WarrantyExpired` is emitted.
 * - Custom errors are used instead of revert strings (cheaper, and typed for the frontend).
 * - Structs are packed so that `Warranty` occupies a single 32 byte storage slot.
 */
contract ProductWarrantyRegistry is AccessControl {
  // ---------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------

  /// @notice May register units and hand them over to retailers.
  bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");

  /// @notice May complete a retail sale (`transferToCustomer`).
  bytes32 public constant RETAILER_ROLE = keccak256("RETAILER_ROLE");

  /// @notice End consumer: may resell the unit and file warranty claims.
  bytes32 public constant CUSTOMER_ROLE = keccak256("CUSTOMER_ROLE");

  /// @notice May adjudicate warranty claims (`resolveWarrantyClaim`).
  bytes32 public constant SERVICE_CENTER_ROLE = keccak256("SERVICE_CENTER_ROLE");

  // ---------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------

  /// @notice The role a holder plays in the supply chain (stored in the ownership history).
  enum PartyRole {
    Unknown, // 0
    Manufacturer, // 1
    Retailer, // 2
    Customer // 3
  }

  /// @notice High level lifecycle state of a registered unit.
  enum ProductStatus {
    None, // 0 - not registered (default)
    Registered, // 1 - with the manufacturer
    InTransit, // 2 - with a distributor / retailer
    Sold, // 3 - in the hands of an end customer
    Recalled // 4 - pulled back by the manufacturer
  }

  /// @notice Warranty state, as required by the product specification.
  enum WarrantyStatus {
    None, // 0 - no warranty (unregistered product)
    Active, // 1 - claims can be filed
    Expired, // 2 - duration elapsed or claim limit reached
    Void // 3 - voided by the manufacturer (recall, abuse, ...)
  }

  /// @notice Why a warranty stopped being active.
  enum ExpirationReason {
    DurationElapsed, // 0
    ClaimLimitReached // 1
  }

  /// @notice Why ownership changed hands.
  enum TransferReason {
    Manufactured, // 0 - initial registration
    Distribution, // 1 - manufacturer -> retailer
    RetailSale, // 2 - retailer -> customer
    Resale, // 3 - customer -> customer
    Recall // 4 - manufacturer takes the unit back
  }

  /// @notice Resolution state of an individual warranty claim.
  enum ClaimStatus {
    Pending, // 0
    Approved, // 1
    Rejected // 2
  }

  /// @notice Static description of the product model (never changes after registration).
  struct ProductModel {
    string brand;
    string modelName;
    string modelNumber;
    string category;
    string metadataURI; // IPFS / HTTPS URI with photos, datasheet, certificates...
  }

  /**
   * @notice Warranty of one unit: the terms frozen at registration plus the live counters.
   * @dev Packed into a single 32 byte storage slot (8 + 8 + 4 + 4 + 1 = 25 bytes).
   * @param startDate      Timestamp the warranty clock started (registration time).
   * @param expirationDate Timestamp at which the warranty stops being active.
   * @param maxClaims      Maximum number of claims allowed; `0` means unlimited.
   * @param claimCount     Claims filed so far (every submission counts, see `submitWarrantyClaim`).
   * @param status         Stored status; expiry is derived, `Void` is only ever set explicitly.
   */
  struct Warranty {
    uint64 startDate;
    uint64 expirationDate;
    uint32 maxClaims;
    uint32 claimCount;
    WarrantyStatus status;
  }

  /**
   * @notice The full on-chain record of one registered unit.
   * @dev `manufacturer`, `createdAt` and `status` are ordered so that they share one slot
   *      (20 + 8 + 1 = 29 bytes).
   */
  struct Product {
    uint256 id; // sequential id assigned by this contract
    string serialNumber; // manufacturer supplied, globally unique
    ProductModel model; // brand / model / metadata
    address manufacturer; // party that registered the unit
    uint64 createdAt; // registration timestamp
    ProductStatus status; // lifecycle state
    address currentOwner; // owner right now
    Warranty warranty; // terms + live counters
  }

  /// @notice A single hop in the chain of custody.
  struct OwnershipRecord {
    address from; // previous holder (zero address for the registration hop)
    address to; // new holder
    PartyRole toRole; // what the receiver is
    TransferReason reason; // why the unit changed hands
    uint64 transferredAt; // block timestamp of the hand-over
    bytes32 evidenceHash; // keccak256 of the invoice / delivery note / photo
  }

  /// @notice A warranty claim filed by the current owner.
  struct WarrantyClaim {
    uint256 claimId; // index within the product's claim list
    address claimant; // owner that filed the claim
    uint64 filedAt;
    uint64 resolvedAt; // 0 while pending
    ClaimStatus status;
    string description; // what went wrong
    string resolution; // filled in by the service centre on resolution
  }

  // ---------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------

  error ZeroAddress();
  error EmptySerialNumber();
  error SerialAlreadyRegistered(string serialNumber);
  error InvalidProductModel();
  error InvalidWarrantyDuration();
  error EmptyReason();
  error EmptyDescription();
  error ProductNotFound(uint256 productId);
  error NotProductOwner(uint256 productId, address caller);
  error NotProductManufacturer(uint256 productId, address caller);
  error AlreadyCurrentOwner(uint256 productId, address owner);
  error ProductIsRecalled(uint256 productId);
  error RecipientNotAuthorized(address account, bytes32 role);
  error WarrantyNotActive(uint256 productId, WarrantyStatus status);
  error WarrantyAlreadyVoided(uint256 productId);
  error ClaimLimitReached(uint256 productId, uint32 maxClaims);
  error UnknownClaim(uint256 productId, uint256 claimId);
  error ClaimAlreadyResolved(uint256 productId, uint256 claimId);
  error UnknownOwnershipRecord(uint256 productId, uint256 index);

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  event ProductRegistered(
    uint256 indexed productId,
    string serialNumber,
    address indexed manufacturer,
    uint64 createdAt
  );
  event WarrantyCreated(uint256 indexed productId, uint64 startDate, uint64 expirationDate, uint32 maxClaims);
  event ProductOwnershipTransferred(
    uint256 indexed productId,
    address indexed from,
    address indexed to,
    PartyRole toRole,
    TransferReason reason,
    bytes32 evidenceHash
  );
  event WarrantyExpired(uint256 indexed productId, ExpirationReason reason, uint64 expirationDate);
  event WarrantyVoided(uint256 indexed productId, string reason);
  event ProductRecalled(uint256 indexed productId, address indexed manufacturer, string reason);
  event WarrantyClaimSubmitted(
    uint256 indexed productId,
    uint256 indexed claimId,
    address indexed claimant,
    string description
  );
  event WarrantyClaimResolved(
    uint256 indexed productId,
    uint256 indexed claimId,
    ClaimStatus status,
    string resolution
  );

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------

  /// @notice Id handed to the next registered product. Ids start at 1 so that
  ///         `productId == 0` always means "does not exist".
  uint256 private _nextProductId = 1;

  /// @notice productId => product record.
  mapping(uint256 productId => Product product) private _products;

  /// @notice keccak256(serialNumber) => productId (0 when unknown).
  mapping(bytes32 serialHash => uint256 productId) private _serialToProductId;

  /// @notice productId => append-only chain of custody.
  mapping(uint256 productId => OwnershipRecord[] history) private _ownershipHistory;

  /// @notice productId => warranty claims filed against the unit.
  mapping(uint256 productId => WarrantyClaim[] claims) private _warrantyClaims;

  // ---------------------------------------------------------------------
  // Modifiers
  // ---------------------------------------------------------------------

  /// @dev Reverts with `AccessControlUnauthorizedAccount` when the caller lacks the role.
  modifier onlyManufacturer() {
    _checkRole(MANUFACTURER_ROLE);
    _;
  }

  /// @dev Reverts with `AccessControlUnauthorizedAccount` when the caller lacks the role.
  modifier onlyRetailer() {
    _checkRole(RETAILER_ROLE);
    _;
  }

  /// @dev Reverts with `AccessControlUnauthorizedAccount` when the caller lacks the role.
  modifier onlyCustomer() {
    _checkRole(CUSTOMER_ROLE);
    _;
  }

  /// @dev Reverts with `AccessControlUnauthorizedAccount` when the caller lacks the role.
  modifier onlyServiceCenter() {
    _checkRole(SERVICE_CENTER_ROLE);
    _;
  }

  modifier productExists(uint256 productId) {
    if (_products[productId].id == 0) revert ProductNotFound(productId);
    _;
  }

  modifier onlyProductOwner(uint256 productId) {
    if (_products[productId].currentOwner != msg.sender) revert NotProductOwner(productId, msg.sender);
    _;
  }

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------

  /**
   * @notice Deploys the registry and makes `initialAdmin` the role administrator.
   * @dev Every other role (manufacturer, retailer, customer, service centre) is granted
   *      afterwards through `grantRole`, so the deployer can hand over control completely.
   * @param initialAdmin Account allowed to grant and revoke roles.
   */
  constructor(address initialAdmin) {
    if (initialAdmin == address(0)) revert ZeroAddress();
    _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
  }

  // ---------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------

  /**
   * @notice Register a newly manufactured unit on-chain.
   * @dev Only accounts holding `MANUFACTURER_ROLE` can register. The caller becomes both the
   *      manufacturer of record and the first owner, and the warranty clock starts now.
   * @param serialNumber            Serial printed on the unit; must be globally unique.
   * @param model                   Static model description (brand, model, metadata URI, ...).
   * @param warrantyDurationSeconds Warranty length counted from now, in seconds (must be > 0).
   * @param maxClaims               Maximum number of claims allowed; `0` means unlimited.
   * @return productId              Sequential id of the new unit (ids start at 1).
   */
  function registerProduct(
    string calldata serialNumber,
    ProductModel calldata model,
    uint64 warrantyDurationSeconds,
    uint32 maxClaims
  ) external onlyManufacturer returns (uint256 productId) {
    if (bytes(serialNumber).length == 0) revert EmptySerialNumber();
    if (bytes(model.brand).length == 0 || bytes(model.modelName).length == 0) revert InvalidProductModel();
    if (warrantyDurationSeconds == 0) revert InvalidWarrantyDuration();

    bytes32 serialHash = keccak256(abi.encodePacked(serialNumber));
    if (_serialToProductId[serialHash] != 0) revert SerialAlreadyRegistered(serialNumber);

    productId = _nextProductId;
    unchecked {
      // `_nextProductId` is a uint256 counter that only ever increases by one.
      _nextProductId = productId + 1;
    }

    _serialToProductId[serialHash] = productId;

    uint64 startDate = uint64(block.timestamp);
    uint64 expirationDate = startDate + warrantyDurationSeconds;

    Product storage product = _products[productId];
    product.id = productId;
    product.serialNumber = serialNumber;
    product.model = model;
    product.manufacturer = msg.sender;
    product.createdAt = startDate;
    product.status = ProductStatus.Registered;
    product.currentOwner = msg.sender;
    product.warranty = Warranty({
      startDate: startDate,
      expirationDate: expirationDate,
      maxClaims: maxClaims,
      claimCount: 0,
      status: WarrantyStatus.Active
    });

    _appendOwnershipRecord(
      productId,
      OwnershipRecord({
        from: address(0),
        to: msg.sender,
        toRole: PartyRole.Manufacturer,
        reason: TransferReason.Manufactured,
        transferredAt: startDate,
        evidenceHash: bytes32(0)
      })
    );

    emit ProductRegistered(productId, serialNumber, msg.sender, startDate);
    emit WarrantyCreated(productId, startDate, expirationDate, maxClaims);
  }

  // ---------------------------------------------------------------------
  // Chain of custody
  // ---------------------------------------------------------------------

  /**
   * @notice Ship a unit from the manufacturer to a retailer (or distributor).
   * @dev Only the manufacturer that currently owns the unit, and the receiver must hold
   *      `RETAILER_ROLE`.
   * @param productId    Unit being shipped.
   * @param retailer     Receiving retailer address.
   * @param evidenceHash keccak256 of the invoice / delivery note (or bytes32(0)).
   */
  function transferToRetailer(
    uint256 productId,
    address retailer,
    bytes32 evidenceHash
  ) external productExists(productId) onlyProductOwner(productId) onlyManufacturer {
    _transfer(
      productId,
      _products[productId],
      retailer,
      RETAILER_ROLE,
      PartyRole.Retailer,
      TransferReason.Distribution,
      ProductStatus.InTransit,
      evidenceHash
    );
  }

  /**
   * @notice Complete a retail sale: hand the unit from the retailer to the end customer.
   * @dev Callable by the retailer that currently owns the unit; the buyer must hold
   *      `CUSTOMER_ROLE`. The warranty clock keeps running across the sale.
   * @param productId    Unit being sold.
   * @param customer     Buying customer address.
   * @param evidenceHash keccak256 of the receipt (or bytes32(0)).
   */
  function transferToCustomer(
    uint256 productId,
    address customer,
    bytes32 evidenceHash
  ) external productExists(productId) onlyProductOwner(productId) onlyRetailer {
    Product storage product = _products[productId];
    _syncWarrantyStatus(productId);

    _transfer(
      productId,
      product,
      customer,
      CUSTOMER_ROLE,
      PartyRole.Customer,
      TransferReason.RetailSale,
      ProductStatus.Sold,
      evidenceHash
    );
  }

  /**
   * @notice Secondary resale: hand the unit from one customer to another.
   * @dev Callable by the customer that currently owns the unit; the buyer must hold
   *      `CUSTOMER_ROLE`. Whatever is left of the warranty travels with the unit.
   * @param productId    Unit being resold.
   * @param newOwner     Buying customer address.
   * @param evidenceHash keccak256 of the private sale agreement (or bytes32(0)).
   */
  function transferOwnership(
    uint256 productId,
    address newOwner,
    bytes32 evidenceHash
  ) external productExists(productId) onlyProductOwner(productId) onlyCustomer {
    Product storage product = _products[productId];
    _syncWarrantyStatus(productId);

    _transfer(
      productId,
      product,
      newOwner,
      CUSTOMER_ROLE,
      PartyRole.Customer,
      TransferReason.Resale,
      ProductStatus.Sold,
      evidenceHash
    );
  }

  // ---------------------------------------------------------------------
  // Warranty handling
  // ---------------------------------------------------------------------

  /**
   * @notice File a warranty claim as the current owner of the unit.
   * @dev Callable by a `CUSTOMER_ROLE` holder that owns the unit, and only while the warranty
   *      is `Active`. Every submission consumes one claim slot, so the warranty expires the
   *      moment the last allowed claim is filed. Counting submissions rather than approvals is
   *      deliberate: it makes claim spam unprofitable.
   * @param productId   Unit the claim is about.
   * @param description Human readable fault description.
   * @return claimId    Index of the claim inside the product's claim list.
   */
  function submitWarrantyClaim(
    uint256 productId,
    string calldata description
  ) external productExists(productId) onlyProductOwner(productId) onlyCustomer returns (uint256 claimId) {
    if (bytes(description).length == 0) revert EmptyDescription();

    Product storage product = _products[productId];
    _syncWarrantyStatus(productId);

    Warranty storage warranty = product.warranty;

    // Checked before the status so that a used-up claim limit reports the precise reason.
    uint32 maxClaims = warranty.maxClaims;
    if (maxClaims != 0 && warranty.claimCount >= maxClaims) revert ClaimLimitReached(productId, maxClaims);
    if (warranty.status != WarrantyStatus.Active) revert WarrantyNotActive(productId, warranty.status);

    warranty.claimCount = warranty.claimCount + 1;

    claimId = _warrantyClaims[productId].length;
    _warrantyClaims[productId].push(
      WarrantyClaim({
        claimId: claimId,
        claimant: msg.sender,
        filedAt: uint64(block.timestamp),
        resolvedAt: 0,
        status: ClaimStatus.Pending,
        description: description,
        resolution: ""
      })
    );

    emit WarrantyClaimSubmitted(productId, claimId, msg.sender, description);

    // Reaching the claim limit expires the warranty immediately.
    if (maxClaims != 0 && warranty.claimCount >= maxClaims) {
      warranty.status = WarrantyStatus.Expired;
      emit WarrantyExpired(productId, ExpirationReason.ClaimLimitReached, warranty.expirationDate);
    }
  }

  /**
   * @notice Approve or reject a pending claim.
   * @dev Restricted to `SERVICE_CENTER_ROLE`. A rejected claim still consumes its slot
   *      (anti-abuse, see `submitWarrantyClaim`), so resolving cannot resurrect a warranty.
   * @param productId  Unit the claim belongs to.
   * @param claimId    Index of the claim within the product's claim list.
   * @param approved   `true` to approve the claim, `false` to reject it.
   * @param resolution Human readable outcome note (e.g. "replacement unit shipped").
   */
  function resolveWarrantyClaim(
    uint256 productId,
    uint256 claimId,
    bool approved,
    string calldata resolution
  ) external productExists(productId) onlyServiceCenter {
    if (claimId >= _warrantyClaims[productId].length) revert UnknownClaim(productId, claimId);

    WarrantyClaim storage claim = _warrantyClaims[productId][claimId];
    if (claim.status != ClaimStatus.Pending) revert ClaimAlreadyResolved(productId, claimId);

    claim.status = approved ? ClaimStatus.Approved : ClaimStatus.Rejected;
    claim.resolvedAt = uint64(block.timestamp);
    claim.resolution = resolution;

    emit WarrantyClaimResolved(productId, claimId, claim.status, resolution);
  }

  /**
   * @notice Void the warranty of a unit (abuse, missing serial, goodwill decision).
   * @dev Only the manufacturer that registered the unit can void it.
   */
  function voidWarranty(uint256 productId, string calldata reason) external productExists(productId) onlyManufacturer {
    if (bytes(reason).length == 0) revert EmptyReason();

    Product storage product = _products[productId];
    if (msg.sender != product.manufacturer) revert NotProductManufacturer(productId, msg.sender);
    if (product.warranty.status == WarrantyStatus.Void) revert WarrantyAlreadyVoided(productId);

    _voidWarranty(productId, reason);
  }

  /**
   * @notice Recall a unit: marks it recalled (blocking further transfers) and voids its warranty.
   * @dev Only the manufacturer that registered the unit can recall it.
   */
  function recallProduct(uint256 productId, string calldata reason) external productExists(productId) onlyManufacturer {
    if (bytes(reason).length == 0) revert EmptyReason();

    Product storage product = _products[productId];
    if (msg.sender != product.manufacturer) revert NotProductManufacturer(productId, msg.sender);
    if (product.status == ProductStatus.Recalled) revert ProductIsRecalled(productId);

    product.status = ProductStatus.Recalled;
    _voidWarranty(productId, reason);

    emit ProductRecalled(productId, msg.sender, reason);
  }

  /**
   * @notice Refresh the stored warranty status of a unit.
   * @dev `getWarrantyStatus` / `isWarrantyActive` always report the truth; this entry point lets
   *      anyone persist an expiry that already happened (and emit `WarrantyExpired`) without
   *      touching the unit, which is handy for indexers and for the frontend.
   */
  function syncWarrantyStatus(uint256 productId) external productExists(productId) {
    _syncWarrantyStatus(productId);
  }

  // ---------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------

  /// @notice Full record of a unit: id, serial, model, manufacturer, owner, status and warranty.
  function getProduct(uint256 productId) external view productExists(productId) returns (Product memory) {
    return _products[productId];
  }

  /// @notice Warranty of a unit (terms frozen at registration plus live counters).
  function getWarranty(uint256 productId) external view productExists(productId) returns (Warranty memory) {
    return _products[productId].warranty;
  }

  /**
   * @notice Current warranty status, derived from the clock and the claim counter.
   * @dev This is the canonical answer: a warranty whose duration elapsed or whose claim limit
   *      was reached reports `Expired` even if the stored status was never synced on-chain.
   *      Returns `None` for a product that does not exist.
   */
  function getWarrantyStatus(uint256 productId) public view returns (WarrantyStatus) {
    Product storage product = _products[productId];
    if (product.id == 0) return WarrantyStatus.None;

    Warranty storage warranty = product.warranty;
    if (warranty.status == WarrantyStatus.Void) return WarrantyStatus.Void;
    if (block.timestamp > warranty.expirationDate) return WarrantyStatus.Expired;
    if (warranty.maxClaims != 0 && warranty.claimCount >= warranty.maxClaims) return WarrantyStatus.Expired;

    return WarrantyStatus.Active;
  }

  /// @notice Whether claims can currently be filed against the unit.
  function isWarrantyActive(uint256 productId) external view returns (bool) {
    return getWarrantyStatus(productId) == WarrantyStatus.Active;
  }

  /// @notice Claims still available (type(uint256).max when the warranty is unlimited).
  function remainingClaims(uint256 productId) external view productExists(productId) returns (uint256) {
    Warranty storage warranty = _products[productId].warranty;
    if (warranty.maxClaims == 0) return type(uint256).max;

    uint32 used = warranty.claimCount;
    return used >= warranty.maxClaims ? 0 : uint256(warranty.maxClaims - used);
  }

  /// @notice Complete chain of custody, oldest hop first.
  function getOwnershipHistory(
    uint256 productId
  ) external view productExists(productId) returns (OwnershipRecord[] memory) {
    return _ownershipHistory[productId];
  }

  /// @notice A single hop of the chain of custody.
  function getOwnershipRecord(
    uint256 productId,
    uint256 index
  ) external view productExists(productId) returns (OwnershipRecord memory) {
    if (index >= _ownershipHistory[productId].length) revert UnknownOwnershipRecord(productId, index);
    return _ownershipHistory[productId][index];
  }

  /// @notice Number of hops recorded so far (>= 1 for any registered product).
  function ownershipHistoryLength(uint256 productId) external view productExists(productId) returns (uint256) {
    return _ownershipHistory[productId].length;
  }

  /// @notice All warranty claims filed against a unit, oldest first.
  function getWarrantyClaims(
    uint256 productId
  ) external view productExists(productId) returns (WarrantyClaim[] memory) {
    return _warrantyClaims[productId];
  }

  /// @notice A single warranty claim.
  function getWarrantyClaim(
    uint256 productId,
    uint256 claimId
  ) external view productExists(productId) returns (WarrantyClaim memory) {
    if (claimId >= _warrantyClaims[productId].length) revert UnknownClaim(productId, claimId);
    return _warrantyClaims[productId][claimId];
  }

  /// @notice Look a product up by the serial number printed on the unit (0 = unknown).
  function getProductIdBySerial(string calldata serialNumber) external view returns (uint256) {
    return _serialToProductId[keccak256(abi.encodePacked(serialNumber))];
  }

  /// @notice Whether a serial number has already been registered.
  function isSerialRegistered(string calldata serialNumber) external view returns (bool) {
    return _serialToProductId[keccak256(abi.encodePacked(serialNumber))] != 0;
  }

  /// @notice Total number of products registered (ids run 1..totalProducts()).
  function totalProducts() external view returns (uint256) {
    return _nextProductId - 1;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /// @dev Appends one hop to the chain of custody and emits the matching event.
  function _appendOwnershipRecord(uint256 productId, OwnershipRecord memory record) private {
    _ownershipHistory[productId].push(record);

    emit ProductOwnershipTransferred(
      productId,
      record.from,
      record.to,
      record.toRole,
      record.reason,
      record.evidenceHash
    );
  }

  /**
   * @dev Shared transfer routine: validates the receiver, moves ownership and records the hop.
   *      Callers only choose which role the receiver must hold and the status the unit moves to.
   *      The address checks run before the role lookup so that a bad address always reports the
   *      precise reason instead of `RecipientNotAuthorized`.
   */
  function _transfer(
    uint256 productId,
    Product storage product,
    address newOwner,
    bytes32 requiredRole,
    PartyRole newOwnerRole,
    TransferReason reason,
    ProductStatus newStatus,
    bytes32 evidenceHash
  ) private {
    if (newOwner == address(0)) revert ZeroAddress();
    if (newOwner == product.currentOwner) revert AlreadyCurrentOwner(productId, newOwner);
    if (product.status == ProductStatus.Recalled) revert ProductIsRecalled(productId);
    if (!hasRole(requiredRole, newOwner)) revert RecipientNotAuthorized(newOwner, requiredRole);

    address previousOwner = product.currentOwner;
    product.currentOwner = newOwner;
    product.status = newStatus;

    _appendOwnershipRecord(
      productId,
      OwnershipRecord({
        from: previousOwner,
        to: newOwner,
        toRole: newOwnerRole,
        reason: reason,
        transferredAt: uint64(block.timestamp),
        evidenceHash: evidenceHash
      })
    );
  }

  /// @dev Marks the warranty as voided. No-op when it is already void, so a recall always succeeds.
  function _voidWarranty(uint256 productId, string calldata reason) private {
    Warranty storage warranty = _products[productId].warranty;
    if (warranty.status == WarrantyStatus.Void) return;

    warranty.status = WarrantyStatus.Void;
    emit WarrantyVoided(productId, reason);
  }

  /**
   * @dev Persists an expiry that has already happened, so the stored status stops lying.
   *      Runs on every state changing interaction that touches a unit; `syncWarrantyStatus`
   *      exposes it publicly so anyone can trigger the transition (and its event).
   */
  function _syncWarrantyStatus(uint256 productId) private {
    Warranty storage warranty = _products[productId].warranty;
    if (warranty.status != WarrantyStatus.Active) return;

    if (block.timestamp > warranty.expirationDate) {
      warranty.status = WarrantyStatus.Expired;
      emit WarrantyExpired(productId, ExpirationReason.DurationElapsed, warranty.expirationDate);
      return;
    }

    uint32 maxClaims = warranty.maxClaims;
    if (maxClaims != 0 && warranty.claimCount >= maxClaims) {
      warranty.status = WarrantyStatus.Expired;
      emit WarrantyExpired(productId, ExpirationReason.ClaimLimitReached, warranty.expirationDate);
    }
  }
}
