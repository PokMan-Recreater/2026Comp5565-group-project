import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { expect } from "chai";
import { network } from "hardhat";

import type { ProductWarrantyRegistry } from "../types/ethers-contracts/ProductWarrantyRegistry.js";

const { ethers, networkHelpers } = await network.create();

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const DAY = 24n * 60n * 60n;
const TWO_YEARS = 730n * DAY;

/** Reusable product model description. */
const MODEL = {
  brand: "Acme",
  modelName: "SuperWidget",
  modelNumber: "SW-1000",
  category: "Home appliance",
  metadataURI: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
};

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Enum values mirrored from the Solidity contract.
 * ethers.js v6 decodes every integer - including enums - as a `bigint`,
 * so these constants are bigints as well.
 */
const WarrantyStatus = { None: 0n, Active: 1n, Expired: 2n, Void: 3n } as const;
const ExpirationReason = { DurationElapsed: 0n, ClaimLimitReached: 1n } as const;
const PartyRole = { Unknown: 0n, Manufacturer: 1n, Retailer: 2n, Customer: 3n } as const;
const ProductStatus = { None: 0n, Registered: 1n, InTransit: 2n, Sold: 3n, Recalled: 4n } as const;
const TransferReason = { Manufactured: 0n, Distribution: 1n, RetailSale: 2n, Resale: 3n, Recall: 4n } as const;
const ClaimStatus = { Pending: 0n, Approved: 1n, Rejected: 2n } as const;

describe("ProductWarrantyRegistry", function () {
  /**
   * Deploys the registry from `admin` and grants each signer exactly one supply-chain role.
   * `outsider` deliberately holds no role at all.
   */
  async function deployFixture() {
    const [admin, manufacturer, retailer, customer, reseller, serviceCenter, outsider] = await ethers.getSigners();

    const registry = await ethers.deployContract("ProductWarrantyRegistry", [admin.address]);
    await registry.waitForDeployment();

    await registry.connect(admin).grantRole(await registry.MANUFACTURER_ROLE(), manufacturer.address);
    await registry.connect(admin).grantRole(await registry.RETAILER_ROLE(), retailer.address);
    await registry.connect(admin).grantRole(await registry.CUSTOMER_ROLE(), customer.address);
    await registry.connect(admin).grantRole(await registry.CUSTOMER_ROLE(), reseller.address);
    await registry.connect(admin).grantRole(await registry.SERVICE_CENTER_ROLE(), serviceCenter.address);

    return { registry, admin, manufacturer, retailer, customer, reseller, serviceCenter, outsider };
  }

  /** Registers a unit and returns its on-chain `productId`. */
  async function registerUnit(
    registry: ProductWarrantyRegistry,
    manufacturer: HardhatEthersSigner,
    serialNumber: string,
    { duration = TWO_YEARS, maxClaims = 2 }: { duration?: bigint; maxClaims?: number } = {},
  ): Promise<bigint> {
    await registry.connect(manufacturer).registerProduct(serialNumber, MODEL, duration, maxClaims);
    return await registry.getProductIdBySerial(serialNumber);
  }

  /** Manufacturer -> Retailer -> Customer, the standard path to an end customer. */
  async function sellToCustomer(
    registry: ProductWarrantyRegistry,
    productId: bigint,
    signers: {
      manufacturer: HardhatEthersSigner;
      retailer: HardhatEthersSigner;
      customer: HardhatEthersSigner;
    },
  ): Promise<void> {
    await registry.connect(signers.manufacturer).transferToRetailer(productId, signers.retailer.address, ZERO_HASH);
    await registry.connect(signers.retailer).transferToCustomer(productId, signers.customer.address, ZERO_HASH);
  }

  // -------------------------------------------------------------------------
  // Roles & access control
  // -------------------------------------------------------------------------

  describe("Roles & access control", function () {
    it("makes the deployer supplied account the role admin", async function () {
      const { registry, admin, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), manufacturer.address)).to.equal(false);
    });

    it("exposes the four supply-chain roles as keccak256 hashes of their names", async function () {
      const { registry } = await networkHelpers.loadFixture(deployFixture);

      expect(await registry.MANUFACTURER_ROLE()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("MANUFACTURER_ROLE")));
      expect(await registry.RETAILER_ROLE()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("RETAILER_ROLE")));
      expect(await registry.CUSTOMER_ROLE()).to.equal(ethers.keccak256(ethers.toUtf8Bytes("CUSTOMER_ROLE")));
      expect(await registry.SERVICE_CENTER_ROLE()).to.equal(
        ethers.keccak256(ethers.toUtf8Bytes("SERVICE_CENTER_ROLE")),
      );
    });

    it("rejects a zero address role admin in the constructor", async function () {
      const { registry } = await networkHelpers.loadFixture(deployFixture);

      await expect(
        ethers.deployContract("ProductWarrantyRegistry", [ethers.ZeroAddress]),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("lets the admin revoke a role, which blocks the revoked account again", async function () {
      const { registry, admin, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      await expect(registry.connect(admin).revokeRole(await registry.MANUFACTURER_ROLE(), manufacturer.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(await registry.MANUFACTURER_ROLE(), manufacturer.address, admin.address);

      expect(await registry.hasRole(await registry.MANUFACTURER_ROLE(), manufacturer.address)).to.equal(false);

      await expect(registry.connect(manufacturer).registerProduct("SW-9000-0001", MODEL, TWO_YEARS, 2))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(manufacturer.address, await registry.MANUFACTURER_ROLE());
    });

    it("only lets the role admin grant roles", async function () {
      const { registry, manufacturer, outsider } = await networkHelpers.loadFixture(deployFixture);

      await expect(registry.connect(outsider).grantRole(await registry.MANUFACTURER_ROLE(), manufacturer.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, await registry.DEFAULT_ADMIN_ROLE());
    });
  });

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  describe("Registration", function () {
    it("stores id, serial, model, manufacturer, owner, timestamp and lifecycle status", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-1000-0001");
      const product = await registry.getProduct(productId);

      expect(productId).to.equal(1n);
      expect(product.id).to.equal(productId);
      expect(product.serialNumber).to.equal("SW-1000-0001");
      expect(product.model.brand).to.equal(MODEL.brand);
      expect(product.model.modelName).to.equal(MODEL.modelName);
      expect(product.model.modelNumber).to.equal(MODEL.modelNumber);
      expect(product.model.category).to.equal(MODEL.category);
      expect(product.model.metadataURI).to.equal(MODEL.metadataURI);
      expect(product.manufacturer).to.equal(manufacturer.address);
      expect(product.currentOwner).to.equal(manufacturer.address);
      expect(product.status).to.equal(ProductStatus.Registered);
      expect(product.createdAt).to.be.greaterThan(0n);
      expect(await registry.totalProducts()).to.equal(1n);
    });

    it("starts the warranty clock at registration and freezes the terms", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-1000-0002", { maxClaims: 3 });
      const warranty = await registry.getWarranty(productId);

      expect(warranty.startDate).to.equal((await registry.getProduct(productId)).createdAt);
      expect(warranty.expirationDate).to.equal(warranty.startDate + TWO_YEARS);
      expect(warranty.maxClaims).to.equal(3n);
      expect(warranty.claimCount).to.equal(0n);
      expect(warranty.status).to.equal(WarrantyStatus.Active);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Active);
      expect(await registry.isWarrantyActive(productId)).to.equal(true);
      expect(await registry.remainingClaims(productId)).to.equal(3n);
    });

    it("emits ProductRegistered, WarrantyCreated and the first chain of custody hop", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const tx = await registry.connect(manufacturer).registerProduct("SW-1000-0003", MODEL, TWO_YEARS, 2);
      const product = await registry.getProduct(1n);

      await expect(tx)
        .to.emit(registry, "ProductRegistered")
        .withArgs(1n, "SW-1000-0003", manufacturer.address, product.createdAt);

      await expect(tx)
        .to.emit(registry, "WarrantyCreated")
        .withArgs(1n, product.warranty.startDate, product.warranty.expirationDate, 2n);

      await expect(tx)
        .to.emit(registry, "ProductOwnershipTransferred")
        .withArgs(
          1n,
          ethers.ZeroAddress,
          manufacturer.address,
          PartyRole.Manufacturer,
          TransferReason.Manufactured,
          ZERO_HASH,
        );

      const history = await registry.getOwnershipHistory(1n);
      expect(history).to.have.lengthOf(1);
      expect(history[0].from).to.equal(ethers.ZeroAddress);
      expect(history[0].to).to.equal(manufacturer.address);
      expect(history[0].toRole).to.equal(PartyRole.Manufacturer);
      expect(history[0].reason).to.equal(TransferReason.Manufactured);
      expect(await registry.ownershipHistoryLength(1n)).to.equal(1n);
    });

    it("rejects a serial number that was already registered", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      await registerUnit(registry, manufacturer, "SW-1000-0004");

      await expect(registry.connect(manufacturer).registerProduct("SW-1000-0004", MODEL, TWO_YEARS, 2))
        .to.be.revertedWithCustomError(registry, "SerialAlreadyRegistered")
        .withArgs("SW-1000-0004");
    });

    it("rejects empty serial numbers, empty models and zero-duration warranties", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);
      const writer = registry.connect(manufacturer);

      await expect(writer.registerProduct("", MODEL, TWO_YEARS, 2)).to.be.revertedWithCustomError(
        registry,
        "EmptySerialNumber",
      );

      await expect(
        writer.registerProduct("SW-1000-0005", { ...MODEL, brand: "" }, TWO_YEARS, 2),
      ).to.be.revertedWithCustomError(registry, "InvalidProductModel");

      await expect(writer.registerProduct("SW-1000-0006", MODEL, 0n, 2)).to.be.revertedWithCustomError(
        registry,
        "InvalidWarrantyDuration",
      );
    });

    it("indexes every unit by its serial number", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      expect(await registry.isSerialRegistered("SW-1000-0007")).to.equal(false);
      expect(await registry.getProductIdBySerial("SW-1000-0007")).to.equal(0n);

      const productId = await registerUnit(registry, manufacturer, "SW-1000-0007");

      expect(await registry.isSerialRegistered("SW-1000-0007")).to.equal(true);
      expect(await registry.getProductIdBySerial("SW-1000-0007")).to.equal(productId);
      expect(await registry.totalProducts()).to.equal(1n);
    });

    it("reverts product lookups for an id that was never registered", async function () {
      const { registry } = await networkHelpers.loadFixture(deployFixture);

      await expect(registry.getProduct(42n)).to.be.revertedWithCustomError(registry, "ProductNotFound").withArgs(42n);
      await expect(registry.getWarranty(42n)).to.be.revertedWithCustomError(registry, "ProductNotFound").withArgs(42n);
      await expect(registry.remainingClaims(42n))
        .to.be.revertedWithCustomError(registry, "ProductNotFound")
        .withArgs(42n);

      expect(await registry.getWarrantyStatus(42n)).to.equal(WarrantyStatus.None);
      expect(await registry.isWarrantyActive(42n)).to.equal(false);
    });
  });

  // -------------------------------------------------------------------------
  // Chain of custody
  // -------------------------------------------------------------------------

  describe("Chain of custody", function () {
    it("records Manufacturer -> Retailer -> Customer -> Resale", async function () {
      const { registry, manufacturer, retailer, customer, reseller } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0001");

      // 1. Manufacturer -> Retailer
      await registry.connect(manufacturer).transferToRetailer(productId, retailer.address, ZERO_HASH);
      let product = await registry.getProduct(productId);
      expect(product.currentOwner).to.equal(retailer.address);
      expect(product.status).to.equal(ProductStatus.InTransit);

      // 2. Retailer -> Customer
      await registry.connect(retailer).transferToCustomer(productId, customer.address, ZERO_HASH);
      product = await registry.getProduct(productId);
      expect(product.currentOwner).to.equal(customer.address);
      expect(product.status).to.equal(ProductStatus.Sold);

      // 3. Customer -> Customer (secondary resale)
      await registry.connect(customer).transferOwnership(productId, reseller.address, ZERO_HASH);
      product = await registry.getProduct(productId);
      expect(product.currentOwner).to.equal(reseller.address);
      expect(product.status).to.equal(ProductStatus.Sold);

      // The full chain is preserved, oldest hop first.
      const history = await registry.getOwnershipHistory(productId);
      expect(history).to.have.lengthOf(4);
      expect(history.map((record: any) => record.from)).to.deep.equal([
        ethers.ZeroAddress,
        manufacturer.address,
        retailer.address,
        customer.address,
      ]);
      expect(history.map((record: any) => record.to)).to.deep.equal([
        manufacturer.address,
        retailer.address,
        customer.address,
        reseller.address,
      ]);
      expect(history.map((record: any) => record.toRole)).to.deep.equal([
        PartyRole.Manufacturer,
        PartyRole.Retailer,
        PartyRole.Customer,
        PartyRole.Customer,
      ]);
      expect(history.map((record: any) => record.reason)).to.deep.equal([
        TransferReason.Manufactured,
        TransferReason.Distribution,
        TransferReason.RetailSale,
        TransferReason.Resale,
      ]);
      expect(await registry.ownershipHistoryLength(productId)).to.equal(4n);
    });

    it("emits ProductOwnershipTransferred with the previous and new owner", async function () {
      const { registry, manufacturer, retailer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0002");

      await expect(registry.connect(manufacturer).transferToRetailer(productId, retailer.address, ZERO_HASH))
        .to.emit(registry, "ProductOwnershipTransferred")
        .withArgs(
          productId,
          manufacturer.address,
          retailer.address,
          PartyRole.Retailer,
          TransferReason.Distribution,
          ZERO_HASH,
        );
    });

    it("stores the evidence hash of every hop", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0003");
      const evidence = ethers.keccak256(ethers.toUtf8Bytes("delivery-note-42"));

      await registry.connect(manufacturer).transferToRetailer(productId, retailer.address, evidence);
      await registry.connect(retailer).transferToCustomer(productId, customer.address, evidence);

      expect((await registry.getOwnershipRecord(productId, 1n)).evidenceHash).to.equal(evidence);
      expect((await registry.getOwnershipRecord(productId, 2n)).evidenceHash).to.equal(evidence);
      expect((await registry.getOwnershipRecord(productId, 0n)).evidenceHash).to.equal(ZERO_HASH);
    });

    it("reverts for an ownership record that does not exist", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0004");

      await expect(registry.getOwnershipRecord(productId, 1n))
        .to.be.revertedWithCustomError(registry, "UnknownOwnershipRecord")
        .withArgs(productId, 1n);
    });

    it("only lets the current owner transfer the unit", async function () {
      const { registry, manufacturer, retailer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0005");
      await registry.connect(manufacturer).transferToRetailer(productId, retailer.address, ZERO_HASH);

      // The manufacturer still holds MANUFACTURER_ROLE but no longer owns the unit.
      await expect(registry.connect(manufacturer).transferToRetailer(productId, retailer.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "NotProductOwner")
        .withArgs(productId, manufacturer.address);

      await expect(registry.connect(retailer).transferToCustomer(productId, retailer.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "AlreadyCurrentOwner")
        .withArgs(productId, retailer.address);
    });

    it("rejects transfers to the zero address", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0006");

      await expect(
        registry.connect(manufacturer).transferToRetailer(productId, ethers.ZeroAddress, ZERO_HASH),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("requires the receiver to hold the matching supply-chain role", async function () {
      const { registry, manufacturer, retailer, customer, outsider } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0007");

      await expect(registry.connect(manufacturer).transferToRetailer(productId, outsider.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "RecipientNotAuthorized")
        .withArgs(outsider.address, await registry.RETAILER_ROLE());

      await registry.connect(manufacturer).transferToRetailer(productId, retailer.address, ZERO_HASH);

      await expect(registry.connect(retailer).transferToCustomer(productId, outsider.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "RecipientNotAuthorized")
        .withArgs(outsider.address, await registry.CUSTOMER_ROLE());

      await registry.connect(retailer).transferToCustomer(productId, customer.address, ZERO_HASH);

      await expect(registry.connect(customer).transferOwnership(productId, outsider.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "RecipientNotAuthorized")
        .withArgs(outsider.address, await registry.CUSTOMER_ROLE());
    });

    it("keeps the retail sale to retailers and the resale to customers", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-2000-0008");

      // The manufacturer owns the unit but is not a retailer.
      await expect(registry.connect(manufacturer).transferToCustomer(productId, customer.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(manufacturer.address, await registry.RETAILER_ROLE());

      await registry.connect(manufacturer).transferToRetailer(productId, retailer.address, ZERO_HASH);

      // The retailer owns the unit but is not a customer.
      await expect(registry.connect(retailer).transferOwnership(productId, customer.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(retailer.address, await registry.CUSTOMER_ROLE());
    });
  });

  // -------------------------------------------------------------------------
  // Warranty claims
  // -------------------------------------------------------------------------

  describe("Warranty claims", function () {
    it("files a pending claim, counts it and emits WarrantyClaimSubmitted", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0001", { maxClaims: 2 });
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await expect(registry.connect(customer).submitWarrantyClaim(productId, "screen flickers"))
        .to.emit(registry, "WarrantyClaimSubmitted")
        .withArgs(productId, 0n, customer.address, "screen flickers");

      const warranty = await registry.getWarranty(productId);
      expect(warranty.claimCount).to.equal(1n);
      expect(warranty.status).to.equal(WarrantyStatus.Active);
      expect(await registry.remainingClaims(productId)).to.equal(1n);

      const claim = await registry.getWarrantyClaim(productId, 0n);
      expect(claim.claimId).to.equal(0n);
      expect(claim.claimant).to.equal(customer.address);
      expect(claim.description).to.equal("screen flickers");
      expect(claim.resolution).to.equal("");
      expect(claim.status).to.equal(ClaimStatus.Pending);
      expect(claim.resolvedAt).to.equal(0n);
      expect(claim.filedAt).to.be.greaterThan(0n);
      expect(await registry.getWarrantyClaims(productId)).to.have.lengthOf(1);
    });

    it("only accepts claims from the current owner holding CUSTOMER_ROLE", async function () {
      const { registry, manufacturer, retailer, customer, outsider } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0002");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await expect(registry.connect(retailer).submitWarrantyClaim(productId, "not my unit"))
        .to.be.revertedWithCustomError(registry, "NotProductOwner")
        .withArgs(productId, retailer.address);

      await expect(registry.connect(outsider).submitWarrantyClaim(productId, "not my unit"))
        .to.be.revertedWithCustomError(registry, "NotProductOwner")
        .withArgs(productId, outsider.address);

      // The manufacturer owns another unit but holds no CUSTOMER_ROLE.
      const secondId = await registerUnit(registry, manufacturer, "SW-3000-0003");
      await expect(registry.connect(manufacturer).submitWarrantyClaim(secondId, "self claim"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(manufacturer.address, await registry.CUSTOMER_ROLE());
    });

    it("rejects an empty fault description", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0004");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await expect(registry.connect(customer).submitWarrantyClaim(productId, "")).to.be.revertedWithCustomError(
        registry,
        "EmptyDescription",
      );
    });

    it("lets the service centre approve a claim", async function () {
      const { registry, manufacturer, retailer, customer, serviceCenter } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0005");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });
      await registry.connect(customer).submitWarrantyClaim(productId, "battery swells");

      await expect(registry.connect(serviceCenter).resolveWarrantyClaim(productId, 0n, true, "replacement shipped"))
        .to.emit(registry, "WarrantyClaimResolved")
        .withArgs(productId, 0n, ClaimStatus.Approved, "replacement shipped");

      const claim = await registry.getWarrantyClaim(productId, 0n);
      expect(claim.status).to.equal(ClaimStatus.Approved);
      expect(claim.resolution).to.equal("replacement shipped");
      expect(claim.resolvedAt).to.be.greaterThan(0n);
    });

    it("lets the service centre reject a claim without refunding the claim slot", async function () {
      const { registry, manufacturer, retailer, customer, serviceCenter } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0006", { maxClaims: 2 });
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });
      await registry.connect(customer).submitWarrantyClaim(productId, "cracked by me");

      await expect(registry.connect(serviceCenter).resolveWarrantyClaim(productId, 0n, false, "accidental damage"))
        .to.emit(registry, "WarrantyClaimResolved")
        .withArgs(productId, 0n, ClaimStatus.Rejected, "accidental damage");

      expect((await registry.getWarrantyClaim(productId, 0n)).status).to.equal(ClaimStatus.Rejected);
      // The slot stays consumed: rejection cannot be used to farm unlimited claims.
      expect((await registry.getWarranty(productId)).claimCount).to.equal(1n);
      expect(await registry.remainingClaims(productId)).to.equal(1n);
    });

    it("refuses to resolve an unknown or already resolved claim", async function () {
      const { registry, manufacturer, retailer, customer, serviceCenter } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0007");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await expect(registry.connect(serviceCenter).resolveWarrantyClaim(productId, 0n, true, "n/a"))
        .to.be.revertedWithCustomError(registry, "UnknownClaim")
        .withArgs(productId, 0n);

      await registry.connect(customer).submitWarrantyClaim(productId, "hinge snapped");
      await registry.connect(serviceCenter).resolveWarrantyClaim(productId, 0n, true, "approved");

      await expect(registry.connect(serviceCenter).resolveWarrantyClaim(productId, 0n, false, "reconsidered"))
        .to.be.revertedWithCustomError(registry, "ClaimAlreadyResolved")
        .withArgs(productId, 0n);
    });

    it("only lets a service centre resolve claims", async function () {
      const { registry, manufacturer, retailer, customer, outsider } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-3000-0008");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });
      await registry.connect(customer).submitWarrantyClaim(productId, "hinge snapped");

      await expect(registry.connect(outsider).resolveWarrantyClaim(productId, 0n, true, "approved"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(outsider.address, await registry.SERVICE_CENTER_ROLE());

      // Even the manufacturer of the unit cannot resolve claims in this design.
      await expect(registry.connect(manufacturer).resolveWarrantyClaim(productId, 0n, true, "approved"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(manufacturer.address, await registry.SERVICE_CENTER_ROLE());
    });
  });

  // -------------------------------------------------------------------------
  // Automatic expiration
  // -------------------------------------------------------------------------

  describe("Automatic expiration", function () {
    it("stops accepting claims once the warranty duration has elapsed", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-4000-0001");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Active);

      // Walk right up to one second before the expiry, then step over it.
      const { expirationDate } = await registry.getWarranty(productId);
      const now = BigInt(await networkHelpers.time.latest());

      await networkHelpers.time.increase(expirationDate - now - 1n);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Active);
      expect(await registry.isWarrantyActive(productId)).to.equal(true);

      await networkHelpers.time.increase(2n);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Expired);
      expect(await registry.isWarrantyActive(productId)).to.equal(false);

      await expect(registry.connect(customer).submitWarrantyClaim(productId, "one day too late"))
        .to.be.revertedWithCustomError(registry, "WarrantyNotActive")
        .withArgs(productId, WarrantyStatus.Expired);
    });

    it("persists a duration expiry through syncWarrantyStatus and only emits once", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-4000-0002");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      const { expirationDate } = await registry.getWarranty(productId);

      // Nobody poked the contract yet, so the stored status is still Active.
      expect((await registry.getWarranty(productId)).status).to.equal(WarrantyStatus.Active);

      await networkHelpers.time.increase(TWO_YEARS + 1n);

      await expect(registry.connect(customer).syncWarrantyStatus(productId))
        .to.emit(registry, "WarrantyExpired")
        .withArgs(productId, ExpirationReason.DurationElapsed, expirationDate);

      expect((await registry.getWarranty(productId)).status).to.equal(WarrantyStatus.Expired);

      // Idempotent: the transition is recorded exactly once.
      await expect(registry.connect(customer).syncWarrantyStatus(productId)).to.not.emit(registry, "WarrantyExpired");
    });

    it("expires the warranty the moment the claim limit is reached", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-4000-0003", { maxClaims: 2 });
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      const claimant = registry.connect(customer);
      await claimant.submitWarrantyClaim(productId, "claim one");
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Active);

      const { expirationDate } = await registry.getWarranty(productId);

      await expect(claimant.submitWarrantyClaim(productId, "claim two"))
        .to.emit(registry, "WarrantyExpired")
        .withArgs(productId, ExpirationReason.ClaimLimitReached, expirationDate);

      expect((await registry.getWarranty(productId)).claimCount).to.equal(2n);
      expect((await registry.getWarranty(productId)).status).to.equal(WarrantyStatus.Expired);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Expired);
      expect(await registry.remainingClaims(productId)).to.equal(0n);

      await expect(claimant.submitWarrantyClaim(productId, "claim three"))
        .to.be.revertedWithCustomError(registry, "ClaimLimitReached")
        .withArgs(productId, 2n);
    });

    it("keeps an unlimited warranty (maxClaims 0) alive across many claims", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-4000-0004", { maxClaims: 0 });
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      expect(await registry.remainingClaims(productId)).to.equal(ethers.MaxUint256);

      for (const description of ["first", "second", "third", "fourth"]) {
        await registry.connect(customer).submitWarrantyClaim(productId, description);
      }

      expect((await registry.getWarranty(productId)).claimCount).to.equal(4n);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Active);
      expect(await registry.remainingClaims(productId)).to.equal(ethers.MaxUint256);
    });

    it("syncs the stored status when an expired unit changes hands", async function () {
      const { registry, manufacturer, retailer, customer, reseller } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-4000-0005");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await networkHelpers.time.increase(TWO_YEARS + 1n);

      await expect(registry.connect(customer).transferOwnership(productId, reseller.address, ZERO_HASH)).to.emit(
        registry,
        "WarrantyExpired",
      );

      // The unit is still resellable, it simply has no warranty left.
      expect((await registry.getProduct(productId)).currentOwner).to.equal(reseller.address);
      expect((await registry.getWarranty(productId)).status).to.equal(WarrantyStatus.Expired);
    });
  });

  // -------------------------------------------------------------------------
  // Voiding & recalls
  // -------------------------------------------------------------------------

  describe("Voiding & recalls", function () {
    it("lets the manufacturer of record void a warranty", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-5000-0001");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await expect(registry.connect(manufacturer).voidWarranty(productId, "liquid damage"))
        .to.emit(registry, "WarrantyVoided")
        .withArgs(productId, "liquid damage");

      expect((await registry.getWarranty(productId)).status).to.equal(WarrantyStatus.Void);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Void);
      expect(await registry.isWarrantyActive(productId)).to.equal(false);

      await expect(registry.connect(customer).submitWarrantyClaim(productId, "still broken"))
        .to.be.revertedWithCustomError(registry, "WarrantyNotActive")
        .withArgs(productId, WarrantyStatus.Void);
    });

    it("refuses to void the same warranty twice or with an empty reason", async function () {
      const { registry, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-5000-0002");

      await expect(registry.connect(manufacturer).voidWarranty(productId, "")).to.be.revertedWithCustomError(
        registry,
        "EmptyReason",
      );

      await registry.connect(manufacturer).voidWarranty(productId, "missing serial");

      await expect(registry.connect(manufacturer).voidWarranty(productId, "again"))
        .to.be.revertedWithCustomError(registry, "WarrantyAlreadyVoided")
        .withArgs(productId);
    });

    it("keeps voiding to the manufacturer that registered the unit", async function () {
      const { registry, admin, manufacturer, outsider } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-5000-0003");

      // A second manufacturer is still not the manufacturer *of record* for this unit.
      await registry.connect(admin).grantRole(await registry.MANUFACTURER_ROLE(), outsider.address);

      await expect(registry.connect(outsider).voidWarranty(productId, "not mine"))
        .to.be.revertedWithCustomError(registry, "NotProductManufacturer")
        .withArgs(productId, outsider.address);
    });

    it("recalls a unit, voiding its warranty and blocking further transfers", async function () {
      const { registry, manufacturer, retailer, customer, reseller } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-5000-0004");
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await expect(registry.connect(manufacturer).recallProduct(productId, "fire hazard"))
        .to.emit(registry, "ProductRecalled")
        .withArgs(productId, manufacturer.address, "fire hazard");

      const product = await registry.getProduct(productId);
      expect(product.status).to.equal(ProductStatus.Recalled);
      expect(product.warranty.status).to.equal(WarrantyStatus.Void);
      expect(await registry.getWarrantyStatus(productId)).to.equal(WarrantyStatus.Void);

      await expect(registry.connect(customer).transferOwnership(productId, reseller.address, ZERO_HASH))
        .to.be.revertedWithCustomError(registry, "ProductIsRecalled")
        .withArgs(productId);

      await expect(registry.connect(customer).submitWarrantyClaim(productId, "still under warranty?"))
        .to.be.revertedWithCustomError(registry, "WarrantyNotActive")
        .withArgs(productId, WarrantyStatus.Void);

      await expect(registry.connect(manufacturer).recallProduct(productId, "again"))
        .to.be.revertedWithCustomError(registry, "ProductIsRecalled")
        .withArgs(productId);
    });

    it("lists every claim of a unit in filing order", async function () {
      const { registry, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(registry, manufacturer, "SW-5000-0005", { maxClaims: 3 });
      await sellToCustomer(registry, productId, { manufacturer, retailer, customer });

      await registry.connect(customer).submitWarrantyClaim(productId, "first fault");
      await registry.connect(customer).submitWarrantyClaim(productId, "second fault");

      const claims = await registry.getWarrantyClaims(productId);
      expect(claims).to.have.lengthOf(2);
      expect(claims.map((claim: any) => claim.claimId)).to.deep.equal([0n, 1n]);
      expect(claims.map((claim: any) => claim.description)).to.deep.equal(["first fault", "second fault"]);
      expect(claims.map((claim: any) => claim.status)).to.deep.equal([ClaimStatus.Pending, ClaimStatus.Pending]);
    });
  });
});
