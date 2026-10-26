import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { expect } from "chai";
import { network } from "hardhat";

import type { ProductProvenance } from "../types/ethers-contracts/ProductProvenance.js";

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

/** Warranty that survives a customer -> customer resale. */
const TRANSFERABLE_TERMS = { durationSeconds: TWO_YEARS, maxClaims: 2, transferable: true };
/** Warranty that dies with the first buyer. */
const NON_TRANSFERABLE_TERMS = { durationSeconds: TWO_YEARS, maxClaims: 2, transferable: false };

/**
 * Enum values mirrored from the Solidity contract.
 * ethers.js v6 decodes every integer - including enums - as a `bigint`,
 * so these constants are bigints as well.
 */
const Role = {
  Unknown: 0n,
  Manufacturer: 1n,
  Retailer: 2n,
  Customer: 3n,
  Reseller: 4n,
  ServiceCenter: 5n,
} as const;
const Status = { None: 0n, Registered: 1n, InTransit: 2n, Sold: 3n, Recalled: 4n } as const;
const Reason = {
  Manufactured: 0n,
  Distribution: 1n,
  RetailSale: 2n,
  Resale: 3n,
  Return: 4n,
  Servicing: 5n,
  Recall: 6n,
} as const;
const ClaimStatus = { Pending: 0n, Approved: 1n, Rejected: 2n } as const;

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("ProductProvenance", function () {
  /**
   * Deploys the registry from `admin` and authorises `manufacturer` as a second
   * account that is allowed to register products.
   */
  async function deployFixture() {
    const [admin, manufacturer, retailer, customer, reseller, outsider] = await ethers.getSigners();

    const provenance = await ethers.deployContract("ProductProvenance", [admin.address]);
    await provenance.waitForDeployment();

    await provenance.connect(admin).setManufacturerAuthorization(manufacturer.address, true);

    return { provenance, admin, manufacturer, retailer, customer, reseller, outsider };
  }

  /** Registers a unit and returns its on-chain `productId`. */
  async function registerUnit(
    provenance: ProductProvenance,
    manufacturer: HardhatEthersSigner,
    serialNumber: string,
    terms: typeof TRANSFERABLE_TERMS = TRANSFERABLE_TERMS,
  ): Promise<bigint> {
    await provenance.connect(manufacturer).registerProduct(serialNumber, MODEL, terms, ZERO_HASH);
    return await provenance.getProductIdBySerial(serialNumber);
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  describe("Registration", function () {
    it("registers a unit and stores id, serial, model, manufacturer and owner", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-1000-0001");
      const product = await provenance.getProduct(productId);

      expect(productId).to.equal(1n);
      expect(product.productId).to.equal(productId);
      expect(product.serialNumber).to.equal("SW-1000-0001");
      expect(product.model.brand).to.equal(MODEL.brand);
      expect(product.model.modelNumber).to.equal(MODEL.modelNumber);
      expect(product.model.metadataURI).to.equal(MODEL.metadataURI);
      expect(product.manufacturer).to.equal(manufacturer.address);
      expect(product.currentOwner).to.equal(manufacturer.address);
      expect(product.status).to.equal(Status.Registered);
      expect(await provenance.totalProducts()).to.equal(1n);
    });

    it("starts the warranty clock and copies the terms verbatim", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-1000-0002", NON_TRANSFERABLE_TERMS);
      const product = await provenance.getProduct(productId);

      expect(product.warrantyTerms.durationSeconds).to.equal(TWO_YEARS);
      expect(product.warrantyTerms.maxClaims).to.equal(2n);
      expect(product.warrantyTerms.transferable).to.equal(false);
      expect(product.warranty.startTime).to.equal(product.registeredAt);
      expect(product.warranty.expirationTime).to.equal(product.registeredAt + TWO_YEARS);
      expect(product.warranty.claimsUsed).to.equal(0n);
      expect(product.warranty.voided).to.equal(false);
      expect(await provenance.isWarrantyValid(productId)).to.equal(true);
      expect(await provenance.remainingClaims(productId)).to.equal(2n);
    });

    it("appends the manufacturer as the first hop of the chain of custody", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-1000-0003");
      const history = await provenance.getOwnershipHistory(productId);

      expect(history).to.have.lengthOf(1);
      expect(history[0].owner).to.equal(manufacturer.address);
      expect(history[0].role).to.equal(Role.Manufacturer);
      expect(history[0].reason).to.equal(Reason.Manufactured);
      expect(await provenance.ownershipHistoryLength(productId)).to.equal(1n);
    });

    it("emits ProductRegistered and ProductOwnershipTransferred", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const registration = provenance
        .connect(manufacturer)
        .registerProduct("SW-1000-0004", MODEL, TRANSFERABLE_TERMS, ZERO_HASH);

      await expect(registration)
        .to.emit(provenance, "ProductRegistered")
        .withArgs(1n, "SW-1000-0004", manufacturer.address, manufacturer.address);

      await expect(registration)
        .to.emit(provenance, "ProductOwnershipTransferred")
        .withArgs(1n, ethers.ZeroAddress, manufacturer.address, Role.Manufacturer, Reason.Manufactured, ZERO_HASH);
    });

    it("rejects a serial number that was already registered", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      await registerUnit(provenance, manufacturer, "SW-1000-0005");

      await expect(
        provenance.connect(manufacturer).registerProduct("SW-1000-0005", MODEL, TRANSFERABLE_TERMS, ZERO_HASH),
      )
        .to.be.revertedWithCustomError(provenance, "SerialAlreadyRegistered")
        .withArgs("SW-1000-0005");
    });

    it("rejects registration from an account that is not an authorised manufacturer", async function () {
      const { provenance, outsider } = await networkHelpers.loadFixture(deployFixture);

      await expect(provenance.connect(outsider).registerProduct("SW-1000-0006", MODEL, TRANSFERABLE_TERMS, ZERO_HASH))
        .to.be.revertedWithCustomError(provenance, "NotAuthorizedManufacturer")
        .withArgs(outsider.address);
    });

    it("rejects empty serial numbers, empty models and zero-duration warranties", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);
      const writer = provenance.connect(manufacturer);

      await expect(writer.registerProduct("", MODEL, TRANSFERABLE_TERMS, ZERO_HASH)).to.be.revertedWithCustomError(
        provenance,
        "EmptySerialNumber",
      );

      await expect(
        writer.registerProduct("SW-1000-0007", { ...MODEL, brand: "" }, TRANSFERABLE_TERMS, ZERO_HASH),
      ).to.be.revertedWithCustomError(provenance, "InvalidProductModel");

      await expect(
        writer.registerProduct("SW-1000-0008", MODEL, { ...TRANSFERABLE_TERMS, durationSeconds: 0n }, ZERO_HASH),
      ).to.be.revertedWithCustomError(provenance, "InvalidWarrantyDuration");
    });

    it("lets the admin revoke and re-grant manufacturer rights", async function () {
      const { provenance, admin, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      await expect(provenance.connect(admin).setManufacturerAuthorization(manufacturer.address, false))
        .to.emit(provenance, "ManufacturerAuthorized")
        .withArgs(manufacturer.address, false);

      expect(await provenance.authorizedManufacturers(manufacturer.address)).to.equal(false);

      await expect(
        provenance.connect(manufacturer).registerProduct("SW-1000-0009", MODEL, TRANSFERABLE_TERMS, ZERO_HASH),
      ).to.be.revertedWithCustomError(provenance, "NotAuthorizedManufacturer");

      await provenance.connect(admin).setManufacturerAuthorization(manufacturer.address, true);
      expect(await provenance.authorizedManufacturers(manufacturer.address)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------------
  // Chain of custody
  // -------------------------------------------------------------------------

  describe("Chain of custody", function () {
    it("records Manufacturer -> Retailer -> Customer -> Resale", async function () {
      const { provenance, manufacturer, retailer, customer, reseller } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-2000-0001");

      // 1. Manufacturer -> Retailer
      await provenance
        .connect(manufacturer)
        .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH);
      let product = await provenance.getProduct(productId);
      expect(product.currentOwner).to.equal(retailer.address);
      expect(product.status).to.equal(Status.InTransit);

      // 2. Retailer -> Customer
      await provenance
        .connect(retailer)
        .transferProductOwnership(productId, customer.address, Role.Customer, Reason.RetailSale, ZERO_HASH);
      product = await provenance.getProduct(productId);
      expect(product.currentOwner).to.equal(customer.address);
      expect(product.status).to.equal(Status.Sold);

      // 3. Customer -> Reseller
      await provenance
        .connect(customer)
        .transferProductOwnership(productId, reseller.address, Role.Reseller, Reason.Resale, ZERO_HASH);
      product = await provenance.getProduct(productId);
      expect(product.currentOwner).to.equal(reseller.address);
      expect(product.status).to.equal(Status.Sold);

      // The full chain is preserved and ordered oldest first.
      const history = await provenance.getOwnershipHistory(productId);
      expect(history).to.have.lengthOf(4);
      expect(history.map((record: any) => record.owner)).to.deep.equal([
        manufacturer.address,
        retailer.address,
        customer.address,
        reseller.address,
      ]);
      expect(history.map((record: any) => record.role)).to.deep.equal([
        Role.Manufacturer,
        Role.Retailer,
        Role.Customer,
        Role.Reseller,
      ]);
      expect(history.map((record: any) => record.reason)).to.deep.equal([
        Reason.Manufactured,
        Reason.Distribution,
        Reason.RetailSale,
        Reason.Resale,
      ]);
    });

    it("emits ProductOwnershipTransferred with the previous and new owner", async function () {
      const { provenance, manufacturer, retailer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-2000-0002");

      await expect(
        provenance
          .connect(manufacturer)
          .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH),
      )
        .to.emit(provenance, "ProductOwnershipTransferred")
        .withArgs(productId, manufacturer.address, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH);
    });

    it("only lets the current owner transfer the unit", async function () {
      const { provenance, manufacturer, retailer, outsider } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-2000-0003");

      await expect(
        provenance
          .connect(outsider)
          .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH),
      )
        .to.be.revertedWithCustomError(provenance, "NotProductOwner")
        .withArgs(productId, outsider.address);
    });

    it("rejects transfers to the zero address or to the current owner", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-2000-0004");
      const writer = provenance.connect(manufacturer);

      await expect(
        writer.transferProductOwnership(productId, ethers.ZeroAddress, Role.Retailer, Reason.Distribution, ZERO_HASH),
      ).to.be.revertedWithCustomError(provenance, "ZeroAddress");

      await expect(
        writer.transferProductOwnership(productId, manufacturer.address, Role.Retailer, Reason.Distribution, ZERO_HASH),
      )
        .to.be.revertedWithCustomError(provenance, "AlreadyCurrentOwner")
        .withArgs(productId, manufacturer.address);
    });

    it("voids a non-transferable warranty when the customer resells the unit", async function () {
      const { provenance, manufacturer, retailer, customer, reseller } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-2000-0005", NON_TRANSFERABLE_TERMS);

      await provenance
        .connect(manufacturer)
        .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH);
      await provenance
        .connect(retailer)
        .transferProductOwnership(productId, customer.address, Role.Customer, Reason.RetailSale, ZERO_HASH);

      expect(await provenance.isWarrantyValid(productId)).to.equal(true);

      await expect(
        provenance
          .connect(customer)
          .transferProductOwnership(productId, reseller.address, Role.Reseller, Reason.Resale, ZERO_HASH),
      )
        .to.emit(provenance, "WarrantyVoided")
        .withArgs(productId, "warranty is not transferable on resale");

      const product = await provenance.getProduct(productId);
      expect(product.warranty.voided).to.equal(true);
      expect(await provenance.isWarrantyValid(productId)).to.equal(false);
    });

    it("keeps a transferable warranty alive across a resale", async function () {
      const { provenance, manufacturer, retailer, customer, reseller } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-2000-0006", TRANSFERABLE_TERMS);

      await provenance
        .connect(manufacturer)
        .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH);
      await provenance
        .connect(retailer)
        .transferProductOwnership(productId, customer.address, Role.Customer, Reason.RetailSale, ZERO_HASH);
      await provenance
        .connect(customer)
        .transferProductOwnership(productId, reseller.address, Role.Reseller, Reason.Resale, ZERO_HASH);

      const product = await provenance.getProduct(productId);
      expect(product.warranty.voided).to.equal(false);
      expect(await provenance.isWarrantyValid(productId)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------------
  // Warranty claims
  // -------------------------------------------------------------------------

  describe("Warranty claims", function () {
    /** Moves a freshly registered unit from the manufacturer to an end customer. */
    async function sellToCustomer(
      provenance: ProductProvenance,
      productId: bigint,
      actors: { manufacturer: HardhatEthersSigner; retailer: HardhatEthersSigner; customer: HardhatEthersSigner },
    ): Promise<void> {
      await provenance
        .connect(actors.manufacturer)
        .transferProductOwnership(productId, actors.retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH);
      await provenance
        .connect(actors.retailer)
        .transferProductOwnership(productId, actors.customer.address, Role.Customer, Reason.RetailSale, ZERO_HASH);
    }

    it("lets the current owner file a claim and the manufacturer resolve it", async function () {
      const { provenance, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0001");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });

      await expect(provenance.connect(customer).fileWarrantyClaim(productId, "screen flickers", ZERO_HASH))
        .to.emit(provenance, "WarrantyClaimFiled")
        .withArgs(productId, 0n, customer.address);

      const product = await provenance.getProduct(productId);
      expect(product.warranty.claimsUsed).to.equal(1n);
      expect(await provenance.remainingClaims(productId)).to.equal(1n);

      const pending = await provenance.getWarrantyClaim(productId, 0n);
      expect(pending.claimant).to.equal(customer.address);
      expect(pending.description).to.equal("screen flickers");
      expect(pending.status).to.equal(ClaimStatus.Pending);
      expect(pending.resolvedAt).to.equal(0n);

      await expect(
        provenance.connect(manufacturer).resolveWarrantyClaim(productId, 0n, true, "replaced under warranty"),
      )
        .to.emit(provenance, "WarrantyClaimResolved")
        .withArgs(productId, 0n, ClaimStatus.Approved, "replaced under warranty");

      const resolved = await provenance.getWarrantyClaim(productId, 0n);
      expect(resolved.status).to.equal(ClaimStatus.Approved);
      expect(resolved.resolution).to.equal("replaced under warranty");
      expect(resolved.resolvedAt).to.be.greaterThan(0n);
    });

    it("counts every claim against the limit and then refuses further claims", async function () {
      const { provenance, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0002");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });

      const claimant = provenance.connect(customer);
      await claimant.fileWarrantyClaim(productId, "claim one", ZERO_HASH);
      await claimant.fileWarrantyClaim(productId, "claim two", ZERO_HASH);

      const product = await provenance.getProduct(productId);
      expect(product.warranty.claimsUsed).to.equal(2n);
      expect(await provenance.remainingClaims(productId)).to.equal(0n);
      expect(await provenance.isWarrantyValid(productId)).to.equal(false);

      await expect(claimant.fileWarrantyClaim(productId, "claim three", ZERO_HASH))
        .to.be.revertedWithCustomError(provenance, "ClaimLimitReached")
        .withArgs(productId, 2n);
    });

    it("only accepts claims from the current owner", async function () {
      const { provenance, manufacturer, retailer, customer, outsider } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0003");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });

      await expect(provenance.connect(retailer).fileWarrantyClaim(productId, "not my unit", ZERO_HASH))
        .to.be.revertedWithCustomError(provenance, "NotProductOwner")
        .withArgs(productId, retailer.address);

      await expect(provenance.connect(outsider).fileWarrantyClaim(productId, "not my unit", ZERO_HASH))
        .to.be.revertedWithCustomError(provenance, "NotProductOwner")
        .withArgs(productId, outsider.address);
    });

    it("rejects claims once the warranty has expired", async function () {
      const { provenance, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0004");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });

      expect(await provenance.isWarrantyValid(productId)).to.equal(true);

      await networkHelpers.time.increase(TWO_YEARS + 1n);

      expect(await provenance.isWarrantyValid(productId)).to.equal(false);

      await expect(provenance.connect(customer).fileWarrantyClaim(productId, "one day too late", ZERO_HASH))
        .to.be.revertedWithCustomError(provenance, "WarrantyNotValid")
        .withArgs(productId);
    });

    it("rejects claims after the manufacturer voided the warranty", async function () {
      const { provenance, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0005");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });

      await expect(provenance.connect(manufacturer).voidWarranty(productId, "liquid damage"))
        .to.emit(provenance, "WarrantyVoided")
        .withArgs(productId, "liquid damage");

      await expect(provenance.connect(manufacturer).voidWarranty(productId, "liquid damage"))
        .to.be.revertedWithCustomError(provenance, "WarrantyAlreadyVoided")
        .withArgs(productId);

      await expect(provenance.connect(customer).fileWarrantyClaim(productId, "still broken", ZERO_HASH))
        .to.be.revertedWithCustomError(provenance, "WarrantyNotValid")
        .withArgs(productId);
    });

    it("refuses to resolve an unknown or already resolved claim", async function () {
      const { provenance, manufacturer, retailer, customer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0006");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });

      await expect(provenance.connect(manufacturer).resolveWarrantyClaim(productId, 0n, true, "n/a"))
        .to.be.revertedWithCustomError(provenance, "UnknownClaim")
        .withArgs(productId, 0n);

      await provenance.connect(customer).fileWarrantyClaim(productId, "battery swells", ZERO_HASH);
      await provenance.connect(manufacturer).resolveWarrantyClaim(productId, 0n, false, "out of scope");

      await expect(provenance.connect(manufacturer).resolveWarrantyClaim(productId, 0n, true, "reconsidered"))
        .to.be.revertedWithCustomError(provenance, "ClaimAlreadyResolved")
        .withArgs(productId, 0n);
    });

    it("only lets an authorised manufacturer resolve claims", async function () {
      const { provenance, manufacturer, retailer, customer, outsider } =
        await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-3000-0007");
      await sellToCustomer(provenance, productId, { manufacturer, retailer, customer });
      await provenance.connect(customer).fileWarrantyClaim(productId, "hinge snapped", ZERO_HASH);

      await expect(provenance.connect(outsider).resolveWarrantyClaim(productId, 0n, true, "approved"))
        .to.be.revertedWithCustomError(provenance, "NotAuthorizedManufacturer")
        .withArgs(outsider.address);
    });
  });

  // -------------------------------------------------------------------------
  // Recalls and warranty administration
  // -------------------------------------------------------------------------

  describe("Recalls and warranty administration", function () {
    it("recalls a unit, voids its warranty and blocks further transfers", async function () {
      const { provenance, manufacturer, retailer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-4000-0001");

      await expect(provenance.connect(manufacturer).recallProduct(productId, "battery fire risk"))
        .to.emit(provenance, "ProductRecalled")
        .withArgs(productId, manufacturer.address, "battery fire risk");

      const product = await provenance.getProduct(productId);
      expect(product.status).to.equal(Status.Recalled);
      expect(product.recallCount).to.equal(1n);
      expect(product.warranty.voided).to.equal(true);
      expect(await provenance.isWarrantyValid(productId)).to.equal(false);

      await expect(provenance.connect(manufacturer).recallProduct(productId, "again"))
        .to.be.revertedWithCustomError(provenance, "ProductIsRecalled")
        .withArgs(productId);

      await expect(
        provenance
          .connect(manufacturer)
          .transferProductOwnership(productId, retailer.address, Role.Retailer, Reason.Distribution, ZERO_HASH),
      )
        .to.be.revertedWithCustomError(provenance, "ProductIsRecalled")
        .withArgs(productId);
    });

    it("only lets the unit's own manufacturer recall or extend the warranty", async function () {
      const { provenance, admin, manufacturer, outsider } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-4000-0002");

      await expect(provenance.connect(outsider).recallProduct(productId, "not mine"))
        .to.be.revertedWithCustomError(provenance, "NotAuthorizedManufacturer")
        .withArgs(outsider.address);

      await expect(provenance.connect(outsider).extendWarranty(productId, 30n * DAY))
        .to.be.revertedWithCustomError(provenance, "NotAuthorizedManufacturer")
        .withArgs(outsider.address);

      // The registry admin is not automatically the manufacturer of every unit.
      await expect(provenance.connect(admin).extendWarranty(productId, 30n * DAY))
        .to.be.revertedWithCustomError(provenance, "NotAuthorizedManufacturer")
        .withArgs(admin.address);
    });

    it("extends the warranty expiry as a goodwill gesture", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-4000-0003", {
        durationSeconds: 30n * DAY,
        maxClaims: 1,
        transferable: true,
      });

      const before = await provenance.getProduct(productId);
      const extendedTo = before.warranty.expirationTime + 30n * DAY;

      await expect(provenance.connect(manufacturer).extendWarranty(productId, 30n * DAY))
        .to.emit(provenance, "WarrantyExtended")
        .withArgs(productId, extendedTo);

      const after = await provenance.getProduct(productId);
      expect(after.warranty.expirationTime).to.equal(extendedTo);
      expect(after.warrantyTerms.durationSeconds).to.equal(30n * DAY);
    });

    it("lets the registry admin void a warranty directly", async function () {
      const { provenance, admin, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-4000-0004");

      await expect(provenance.connect(admin).voidWarranty(productId, "fraudulent registration"))
        .to.emit(provenance, "WarrantyVoided")
        .withArgs(productId, "fraudulent registration");

      expect(await provenance.isWarrantyValid(productId)).to.equal(false);
    });
  });

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  describe("Views", function () {
    it("looks a product up by the serial number printed on the unit", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      expect(await provenance.isRegistered("SW-5000-0001")).to.equal(false);
      expect(await provenance.getProductIdBySerial("SW-5000-0001")).to.equal(0n);

      const productId = await registerUnit(provenance, manufacturer, "SW-5000-0001");

      expect(await provenance.isRegistered("SW-5000-0001")).to.equal(true);
      expect(await provenance.getProductIdBySerial("SW-5000-0001")).to.equal(productId);
      expect(await provenance.getProductIdBySerial("SW-5000-9999")).to.equal(0n);
    });

    it("reverts when reading a product that was never registered", async function () {
      const { provenance } = await networkHelpers.loadFixture(deployFixture);

      await expect(provenance.getProduct(999n))
        .to.be.revertedWithCustomError(provenance, "ProductNotFound")
        .withArgs(999n);

      await expect(provenance.getOwnershipHistory(999n))
        .to.be.revertedWithCustomError(provenance, "ProductNotFound")
        .withArgs(999n);
    });

    it("treats maxClaims = 0 as an unlimited number of claims", async function () {
      const { provenance, manufacturer } = await networkHelpers.loadFixture(deployFixture);

      const productId = await registerUnit(provenance, manufacturer, "SW-5000-0002", {
        durationSeconds: TWO_YEARS,
        maxClaims: 0,
        transferable: true,
      });

      expect(await provenance.remainingClaims(productId)).to.equal(ethers.MaxUint256);
      expect(await provenance.isWarrantyValid(productId)).to.equal(true);
    });
  });
});
