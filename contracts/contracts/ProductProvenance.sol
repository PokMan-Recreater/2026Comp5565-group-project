// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  ProductProvenance
 * @author COMP5565 Group Project
 * @notice On-chain registry that records the provenance (chain of custody) and the
 *         warranty status of physical products.
 *
 * The contract models the typical real-world life of a durable good:
 *
 *     Manufacturer --> Retailer --> Customer --> (Resale) --> Customer #2
 *                                                         \-> Service centre
 *
 * Every hand-over is appended to an immutable, per-product ownership history so that
 * any party can independently verify where a unit came from and who owns it today.
 * Warranty terms are fixed at registration time, while the mutable warranty state
 * (claims used, voided flag, extended expiry) is tracked separately.
 *
 * Design notes
 * ------------
 * - `productId` is a sequential `uint256` assigned by the contract and used as the
 *   primary key everywhere. The manufacturer supplied `serialNumber` is hashed and
 *   mapped to it so that a serial number can only ever be registered once.
 * - Arrays are kept in dedicated mappings instead of inside the `Product` struct so
 *   that reading a product never pays for its whole history.
 * - Custom errors are used instead of revert strings (cheaper, and typed for the
 *   frontend / test-suite).
 */
contract ProductProvenance is Ownable {
  // ---------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------

  /// @notice The role a holder plays in the supply chain.
  enum PartyRole {
    Unknown, // 0
    Manufacturer, // 1
    Retailer, // 2
    Customer, // 3
    Reseller, // 4  (a customer selling on to another customer)
    ServiceCenter // 5
  }

  /// @notice High level lifecycle state of a registered unit.
  enum ProductStatus {
    None, // 0 - not registered (default)
    Registered, // 1 - with the manufacturer / still in the factory
    InTransit, // 2 - with a distributor or retailer
    Sold, // 3 - in the hands of an end customer
    Recalled // 4 - pulled back by the manufacturer
  }

  /// @notice The reason ownership changed hands.
  enum TransferReason {
    Manufactured, // 0 - initial registration
    Distribution, // 1 - manufacturer -> warehouse / retailer
    RetailSale, // 2 - retailer -> customer
    Resale, // 3 - customer -> customer
    Return, // 4 - customer -> retailer (refund / RMA)
    Servicing, // 5 - temporarily held by a service centre
    Recall // 6 - manufacturer takes the unit back
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

  /// @notice The warranty contract agreed at registration time (immutable).
  struct WarrantyTerms {
    uint64 durationSeconds; // e.g. 730 days = 63_072_000
    uint32 maxClaims; // 0 means "unlimited"
    bool transferable; // does the warranty survive a customer -> customer resale?
  }

  /// @notice Mutable bookkeeping for the warranty of one unit.
  struct WarrantyState {
    uint64 startTime; // set at registration
    uint64 expirationTime; // startTime + durationSeconds (can be extended)
    uint32 claimsUsed; // incremented on every filed claim
    bool voided; // set on recall / non-transferable resale / manual void
  }

  /// @notice A single hop in the chain of custody.
  struct OwnershipRecord {
    address owner; // who received the product
    PartyRole role; // what that party is
    uint64 transferredAt; // block timestamp of the hand-over
    TransferReason reason; // why it changed hands
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
    string resolution; // filled in by the manufacturer on resolution
    bytes32 evidenceHash; // keccak256 of the fault report / photos
  }

  /// @notice The full on-chain record of one registered unit.
  struct Product {
    uint256 productId; // sequential id assigned by this contract
    string serialNumber; // manufacturer supplied, globally unique
    ProductModel model; // brand / model / metadata
    address manufacturer; // party that registered the unit
    address currentOwner; // owner right now
    ProductStatus status; // lifecycle state
    WarrantyTerms warrantyTerms; // immutable warranty contract
    WarrantyState warranty; // live warranty state
    uint64 registeredAt;
    uint32 recallCount; // how many times the unit was recalled
  }

  // ---------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------

  error ProductNotFound(uint256 productId);
  error NotProductOwner(uint256 productId, address caller);
  error NotAuthorizedManufacturer(address caller);
  error EmptySerialNumber();
  error SerialAlreadyRegistered(string serialNumber);
  error ZeroAddress();
  error AlreadyCurrentOwner(uint256 productId, address owner);
  error InvalidWarrantyDuration();
  error InvalidProductModel();
  error ProductIsRecalled(uint256 productId);
  error WarrantyNotValid(uint256 productId);
  error ClaimLimitReached(uint256 productId, uint32 maxClaims);
  error EmptyDescription();
  error UnknownClaim(uint256 productId, uint256 claimId);
  error ClaimAlreadyResolved(uint256 productId, uint256 claimId);
  error NothingToExtend();
  error WarrantyAlreadyVoided(uint256 productId);

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  event ManufacturerAuthorized(address indexed manufacturer, bool authorized);
  event ProductRegistered(
    uint256 indexed productId,
    string serialNumber,
    address indexed manufacturer,
    address indexed initialOwner
  );
  event ProductOwnershipTransferred(
    uint256 indexed productId,
    address indexed from,
    address indexed to,
    PartyRole role,
    TransferReason reason,
    bytes32 evidenceHash
  );
  event WarrantyClaimFiled(uint256 indexed productId, uint256 indexed claimId, address indexed claimant);
  event WarrantyClaimResolved(
    uint256 indexed productId,
    uint256 indexed claimId,
    ClaimStatus status,
    string resolution
  );
  event WarrantyVoided(uint256 indexed productId, string reason);
  event WarrantyExtended(uint256 indexed productId, uint64 newExpirationTime);
  event ProductRecalled(uint256 indexed productId, address indexed manufacturer, string reason);

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

  /// @notice Accounts allowed to register new products (and to resolve claims).
  mapping(address account => bool authorized) public authorizedManufacturers;

  // ---------------------------------------------------------------------
  // Modifiers
  // ---------------------------------------------------------------------

  modifier onlyAuthorizedManufacturer() {
    if (!authorizedManufacturers[msg.sender]) revert NotAuthorizedManufacturer(msg.sender);
    _;
  }

  modifier productExists(uint256 productId) {
    if (_products[productId].productId == 0) revert ProductNotFound(productId);
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
   * @param initialOwner Project admin / registry operator. Also becomes the first
   *        authorised manufacturer so the registry is usable right after deployment.
   */
  constructor(address initialOwner) Ownable(initialOwner) {
    authorizedManufacturers[initialOwner] = true;
    emit ManufacturerAuthorized(initialOwner, true);
  }

  // ---------------------------------------------------------------------
  // Manufacturer management
  // ---------------------------------------------------------------------

  /**
   * @notice Grant or revoke the right to register products and resolve claims.
   * @dev Only the contract owner (project admin) can call this.
   */
  function setManufacturerAuthorization(address manufacturer, bool authorized) external onlyOwner {
    if (manufacturer == address(0)) revert ZeroAddress();
    authorizedManufacturers[manufacturer] = authorized;
    emit ManufacturerAuthorized(manufacturer, authorized);
  }

  // ---------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------

  /**
   * @notice Register a newly manufactured unit on-chain.
   * @dev The caller becomes both the `manufacturer` and the first `currentOwner`.
   *      Warranty terms are frozen here and can afterwards only be extended
   *      (never weakened) through {extendWarranty}.
   * @param serialNumber Unique serial number printed on the unit.
   * @param model        Brand / model / metadata of the unit.
   * @param terms        Warranty contract for this unit.
   * @param evidenceHash keccak256 of the manufacturing certificate (or bytes32(0)).
   * @return productId   The id assigned to the new product.
   */
  function registerProduct(
    string calldata serialNumber,
    ProductModel calldata model,
    WarrantyTerms calldata terms,
    bytes32 evidenceHash
  ) external onlyAuthorizedManufacturer returns (uint256 productId) {
    if (bytes(serialNumber).length == 0) revert EmptySerialNumber();
    if (bytes(model.brand).length == 0 || bytes(model.modelNumber).length == 0) revert InvalidProductModel();
    if (terms.durationSeconds == 0) revert InvalidWarrantyDuration();

    bytes32 serialHash = _hashSerial(serialNumber);
    if (_serialToProductId[serialHash] != 0) revert SerialAlreadyRegistered(serialNumber);

    productId = _nextProductId++;
    uint64 now_ = uint64(block.timestamp);

    Product storage product = _products[productId];
    product.productId = productId;
    product.serialNumber = serialNumber;
    product.model = model;
    product.manufacturer = msg.sender;
    product.currentOwner = msg.sender;
    product.status = ProductStatus.Registered;
    product.registeredAt = now_;
    product.warrantyTerms = terms;
    product.warranty = WarrantyState({
      startTime: now_,
      expirationTime: now_ + terms.durationSeconds,
      claimsUsed: 0,
      voided: false
    });

    _serialToProductId[serialHash] = productId;

    // First hop of the chain of custody: the manufacturer itself.
    _ownershipHistory[productId].push(
      OwnershipRecord({
        owner: msg.sender,
        role: PartyRole.Manufacturer,
        transferredAt: now_,
        reason: TransferReason.Manufactured,
        evidenceHash: evidenceHash
      })
    );

    emit ProductRegistered(productId, serialNumber, msg.sender, msg.sender);
    emit ProductOwnershipTransferred(
      productId,
      address(0),
      msg.sender,
      PartyRole.Manufacturer,
      TransferReason.Manufactured,
      evidenceHash
    );
  }

  // ---------------------------------------------------------------------
  // Chain of custody
  // ---------------------------------------------------------------------

  /**
   * @notice Hand the unit over to a new holder and append the hop to the history.
   * @dev Only the current owner can transfer. A `Resale` of a unit whose warranty
   *      is not transferable voids the warranty automatically.
   * @param productId    Unit being transferred.
   * @param newOwner     Receiving address (retailer, customer, service centre...).
   * @param newOwnerRole Role the receiver plays in the supply chain.
   * @param reason       Why the unit changed hands.
   * @param evidenceHash keccak256 of the invoice / delivery note (or bytes32(0)).
   */
  function transferProductOwnership(
    uint256 productId,
    address newOwner,
    PartyRole newOwnerRole,
    TransferReason reason,
    bytes32 evidenceHash
  ) external productExists(productId) onlyProductOwner(productId) {
    Product storage product = _products[productId];

    if (newOwner == address(0)) revert ZeroAddress();
    if (newOwner == product.currentOwner) revert AlreadyCurrentOwner(productId, newOwner);
    if (product.status == ProductStatus.Recalled) revert ProductIsRecalled(productId);

    address previousOwner = product.currentOwner;

    // A non-transferable warranty dies with the original buyer.
    if (reason == TransferReason.Resale && !product.warrantyTerms.transferable) {
      _voidWarranty(productId, "warranty is not transferable on resale");
    }

    product.currentOwner = newOwner;

    if (reason == TransferReason.Recall) {
      product.status = ProductStatus.Recalled;
      product.recallCount += 1;
    } else if (
      reason == TransferReason.RetailSale || reason == TransferReason.Resale || newOwnerRole == PartyRole.Customer
    ) {
      product.status = ProductStatus.Sold;
    } else {
      product.status = ProductStatus.InTransit;
    }

    _ownershipHistory[productId].push(
      OwnershipRecord({
        owner: newOwner,
        role: newOwnerRole,
        transferredAt: uint64(block.timestamp),
        reason: reason,
        evidenceHash: evidenceHash
      })
    );

    emit ProductOwnershipTransferred(productId, previousOwner, newOwner, newOwnerRole, reason, evidenceHash);
  }

  // ---------------------------------------------------------------------
  // Warranty handling
  // ---------------------------------------------------------------------

  /**
   * @notice File a warranty claim as the current owner of the unit.
   * @return claimId Index of the claim inside the product's claim list.
   */
  function fileWarrantyClaim(
    uint256 productId,
    string calldata description,
    bytes32 evidenceHash
  ) external productExists(productId) onlyProductOwner(productId) returns (uint256 claimId) {
    Product storage product = _products[productId];

    uint32 maxClaims = product.warrantyTerms.maxClaims;
    if (maxClaims != 0 && product.warranty.claimsUsed >= maxClaims) {
      revert ClaimLimitReached(productId, maxClaims);
    }
    if (!isWarrantyValid(productId)) revert WarrantyNotValid(productId);
    if (bytes(description).length == 0) revert EmptyDescription();

    product.warranty.claimsUsed += 1;

    claimId = _warrantyClaims[productId].length;
    _warrantyClaims[productId].push(
      WarrantyClaim({
        claimId: claimId,
        claimant: msg.sender,
        filedAt: uint64(block.timestamp),
        resolvedAt: 0,
        status: ClaimStatus.Pending,
        description: description,
        resolution: "",
        evidenceHash: evidenceHash
      })
    );

    emit WarrantyClaimFiled(productId, claimId, msg.sender);
  }

  /**
   * @notice Approve or reject a pending claim. Restricted to authorised manufacturers.
   */
  function resolveWarrantyClaim(
    uint256 productId,
    uint256 claimId,
    bool approved,
    string calldata resolution
  ) external productExists(productId) onlyAuthorizedManufacturer {
    if (claimId >= _warrantyClaims[productId].length) revert UnknownClaim(productId, claimId);

    WarrantyClaim storage claim = _warrantyClaims[productId][claimId];
    if (claim.status != ClaimStatus.Pending) revert ClaimAlreadyResolved(productId, claimId);

    claim.status = approved ? ClaimStatus.Approved : ClaimStatus.Rejected;
    claim.resolvedAt = uint64(block.timestamp);
    claim.resolution = resolution;

    emit WarrantyClaimResolved(productId, claimId, claim.status, resolution);
  }

  /**
   * @notice Void the warranty of a unit (recall, abuse, non-transferable resale...).
   * @dev Callable by the unit's manufacturer or by the contract owner.
   */
  function voidWarranty(uint256 productId, string calldata reason) external productExists(productId) {
    Product storage product = _products[productId];
    if (msg.sender != product.manufacturer && msg.sender != owner()) {
      revert NotAuthorizedManufacturer(msg.sender);
    }
    if (product.warranty.voided) revert WarrantyAlreadyVoided(productId);
    _voidWarranty(productId, reason);
  }

  /**
   * @notice Push the warranty expiry further into the future (goodwill extension).
   * @dev Only the unit's manufacturer can extend, and only while the warranty is alive.
   */
  function extendWarranty(uint256 productId, uint64 extraSeconds) external productExists(productId) {
    Product storage product = _products[productId];
    if (msg.sender != product.manufacturer) revert NotAuthorizedManufacturer(msg.sender);
    if (extraSeconds == 0) revert NothingToExtend();
    if (product.warranty.voided) revert WarrantyAlreadyVoided(productId);

    product.warranty.expirationTime += extraSeconds;
    emit WarrantyExtended(productId, product.warranty.expirationTime);
  }

  /**
   * @notice Recall a unit: marks it recalled and voids its warranty.
   * @dev Only the manufacturer that registered the unit can recall it.
   */
  function recallProduct(uint256 productId, string calldata reason) external productExists(productId) {
    Product storage product = _products[productId];
    if (msg.sender != product.manufacturer) revert NotAuthorizedManufacturer(msg.sender);
    if (product.status == ProductStatus.Recalled) revert ProductIsRecalled(productId);

    product.status = ProductStatus.Recalled;
    product.recallCount += 1;
    _voidWarranty(productId, reason);

    emit ProductRecalled(productId, msg.sender, reason);
  }

  // ---------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------

  /// @notice Full record of a product.
  function getProduct(uint256 productId) external view productExists(productId) returns (Product memory) {
    return _products[productId];
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
    return _ownershipHistory[productId][index];
  }

  /// @notice Number of hops recorded so far (>= 1 for any registered product).
  function ownershipHistoryLength(uint256 productId) external view productExists(productId) returns (uint256) {
    return _ownershipHistory[productId].length;
  }

  /// @notice All warranty claims filed against a unit.
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
    return _serialToProductId[_hashSerial(serialNumber)];
  }

  /// @notice Whether a serial number has already been registered.
  function isRegistered(string calldata serialNumber) external view returns (bool) {
    return _serialToProductId[_hashSerial(serialNumber)] != 0;
  }

  /// @notice Total number of products registered (ids run 1..totalProducts()).
  function totalProducts() external view returns (uint256) {
    return _nextProductId - 1;
  }

  /// @notice Claims still available under the warranty (type(uint256).max when unlimited).
  function remainingClaims(uint256 productId) external view productExists(productId) returns (uint256) {
    WarrantyTerms storage terms = _products[productId].warrantyTerms;
    if (terms.maxClaims == 0) return type(uint256).max;

    uint32 used = _products[productId].warranty.claimsUsed;
    return used >= terms.maxClaims ? 0 : terms.maxClaims - used;
  }

  /**
   * @notice Whether the warranty of a unit is currently valid.
   * @dev Invalid when the product is unknown, voided, recalled, expired, or out of claims.
   */
  function isWarrantyValid(uint256 productId) public view returns (bool) {
    Product storage product = _products[productId];
    if (product.productId == 0) return false;
    if (product.warranty.voided) return false;
    if (product.status == ProductStatus.Recalled) return false;
    if (block.timestamp > product.warranty.expirationTime) return false;

    uint32 maxClaims = product.warrantyTerms.maxClaims;
    if (maxClaims != 0 && product.warranty.claimsUsed >= maxClaims) return false;

    return true;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  function _hashSerial(string calldata serialNumber) private pure returns (bytes32) {
    return keccak256(abi.encodePacked(serialNumber));
  }

  function _voidWarranty(uint256 productId, string memory reason) private {
    Product storage product = _products[productId];
    if (product.warranty.voided) return;

    product.warranty.voided = true;
    emit WarrantyVoided(productId, reason);
  }
}
