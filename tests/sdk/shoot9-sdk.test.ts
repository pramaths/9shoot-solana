import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Shoot9Solana } from "../../target/types/shoot_9_solana";
import { expect } from "chai";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import Shoot9SDK from "../../sdk/contract-sdk";

describe("shoot9-solana sdk tests", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Shoot9Solana as Program<Shoot9Solana>;
  const connection = provider.connection;

  // Create wallets for testing
  const adminWallet = new anchor.Wallet(Keypair.generate());
  const creatorWallet = new anchor.Wallet(Keypair.generate());
  const user1Wallet = new anchor.Wallet(Keypair.generate());
  const user2Wallet = new anchor.Wallet(Keypair.generate());
  const user3Wallet = new anchor.Wallet(Keypair.generate());
  const feeReceiverWallet = new anchor.Wallet(Keypair.generate());

  // Initialize SDKs
  let adminSDK: Shoot9SDK;
  let creatorSDK: Shoot9SDK;
  let user1SDK: Shoot9SDK;
  let user2SDK: Shoot9SDK;

  // Contest details
  const contestId = 1;
  const entryFee = 0.1; // SOL
  const contestName = "Test Contest";

  before(async () => {
    // Airdrop SOL to all wallets for testing
    await Promise.all([
      airdropSol(connection, adminWallet.publicKey, 10),
      airdropSol(connection, creatorWallet.publicKey, 10),
      airdropSol(connection, user1Wallet.publicKey, 10),
      airdropSol(connection, user2Wallet.publicKey, 10),
      airdropSol(connection, user3Wallet.publicKey, 10),
      airdropSol(connection, feeReceiverWallet.publicKey, 1),
    ]);

    // Initialize SDKs
    adminSDK = new Shoot9SDK(connection, adminWallet);
    creatorSDK = new Shoot9SDK(connection, creatorWallet);
    user1SDK = new Shoot9SDK(connection, user1Wallet);
    user2SDK = new Shoot9SDK(connection, user2Wallet);

    console.log("Test setup complete!");
  });

  it("Initializes auth store", async () => {
    const tx = await adminSDK.initializeAuth();
    expect(tx).to.be.a("string");

    const creators = await adminSDK.getAuthorizedCreators();
    expect(creators).to.be.an("array").that.is.empty;
  });

  it("Adds an authorized creator", async () => {
    const tx = await adminSDK.updateCreatorAuth(creatorWallet.publicKey);
    expect(tx).to.be.a("string");

    const creators = await adminSDK.getAuthorizedCreators();
    console.log("Authorized creators:", creators);
    expect(creators).to.be.an("array").with.lengthOf(1);
    expect(creators[0].toString()).to.equal(creatorWallet.publicKey.toString());
  });

  it("Creates a contest", async () => {
    const tx = await creatorSDK.createContest(
      contestId,
      entryFee,
      contestName,
      feeReceiverWallet.publicKey
    );
    expect(tx).to.be.a("string");

    const contest = await creatorSDK.getContest(
      creatorWallet.publicKey,
      contestId
    );
    expect(contest.contestId.toNumber()).to.equal(contestId);
    expect(contest.entryFee.toNumber()).to.equal(entryFee * LAMPORTS_PER_SOL);
    expect(contest.name).to.equal(contestName);
    expect(contest.feeReceiver.toString()).to.equal(
      feeReceiverWallet.publicKey.toString()
    );
    expect(contest.status).to.deep.equal({ open: {} });
    expect(contest.totalPool.toNumber()).to.equal(0);
    expect(contest.participants).to.be.an("array").that.is.empty;
  });

  it("Users enter the contest", async () => {
    // User 1 enters
    const tx1 = await user1SDK.enterContest(creatorWallet.publicKey, contestId);
    expect(tx1).to.be.a("string");

    // User 2 enters
    const tx2 = await user2SDK.enterContest(creatorWallet.publicKey, contestId);
    expect(tx2).to.be.a("string");

    // Check participants and pool
    const contest = await creatorSDK.getContest(
      creatorWallet.publicKey,
      contestId
    );
    expect(contest.participants).to.be.an("array").with.lengthOf(2);
    expect(contest.totalPool.toNumber()).to.equal(
      entryFee * 2 * LAMPORTS_PER_SOL
    );

    // Check participant list
    const participants = await creatorSDK.getContestParticipants(
      creatorWallet.publicKey,
      contestId
    );
    expect(participants).to.be.an("array").with.lengthOf(2);
    expect(participants.map((p) => p.toString())).to.include(
      user1Wallet.publicKey.toString()
    );
    expect(participants.map((p) => p.toString())).to.include(
      user2Wallet.publicKey.toString()
    );

    // Check pool amount
    const pool = await creatorSDK.getContestPool(
      creatorWallet.publicKey,
      contestId
    );
    expect(pool).to.equal(entryFee * 2);
  });

  it("Resolves contest with variable number of winners", async () => {
    // Get initial balances
    const initialUser1Balance = await connection.getBalance(
      user1Wallet.publicKey
    );
    const initialUser2Balance = await connection.getBalance(
      user2Wallet.publicKey
    );
    const initialUser3Balance = await connection.getBalance(
      user3Wallet.publicKey
    );
    const initialFeeReceiverBalance = await connection.getBalance(
      feeReceiverWallet.publicKey
    );

    // Calculate expected payouts and fee
    const totalPool = entryFee * 2 * LAMPORTS_PER_SOL;
    const feeAmount = totalPool / 10; // 10% fee
    const remainingPool = totalPool - feeAmount;

    // Create winners list with 3 winners - user1, user2, and user3 (who didn't even participate)
    const winners = [
      {
        wallet: user1Wallet.publicKey,
        payout: (remainingPool * 0.5) / LAMPORTS_PER_SOL, // 50% of remaining pool
      },
      {
        wallet: user2Wallet.publicKey,
        payout: (remainingPool * 0.3) / LAMPORTS_PER_SOL, // 30% of remaining pool
      },
      {
        wallet: user3Wallet.publicKey,
        payout: (remainingPool * 0.2) / LAMPORTS_PER_SOL, // 20% of remaining pool
      },
    ];

    // Resolve contest
    const tx = await creatorSDK.resolveContest(
      contestId,
      winners,
      feeReceiverWallet.publicKey
    );
    expect(tx).to.be.a("string");

    // Check contest status
    const contest = await creatorSDK.getContest(
      creatorWallet.publicKey,
      contestId
    );
    expect(contest.status).to.deep.equal({ resolved: {} });

    // Verify balances (with some tolerance for transaction fees)
    const finalUser1Balance = await connection.getBalance(
      user1Wallet.publicKey
    );
    const finalUser2Balance = await connection.getBalance(
      user2Wallet.publicKey
    );
    const finalUser3Balance = await connection.getBalance(
      user3Wallet.publicKey
    );
    const finalFeeReceiverBalance = await connection.getBalance(
      feeReceiverWallet.publicKey
    );

    const user1Payout = Math.floor(remainingPool * 0.5);
    const user2Payout = Math.floor(remainingPool * 0.3);
    const user3Payout = Math.floor(remainingPool * 0.2);

    expect(finalUser1Balance).to.be.closeTo(
      initialUser1Balance + user1Payout,
      100000
    );
    expect(finalUser2Balance).to.be.closeTo(
      initialUser2Balance + user2Payout,
      100000
    );
    expect(finalUser3Balance).to.be.closeTo(
      initialUser3Balance + user3Payout,
      100000
    );
    expect(finalFeeReceiverBalance).to.be.closeTo(
      initialFeeReceiverBalance + feeAmount,
      100000
    );
  });

  it("Cannot enter a resolved contest", async () => {
    try {
      await user1SDK.enterContest(creatorWallet.publicKey, contestId);
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.message).to.include("Failed to enter contest");
    }
  });

  it("Creates and resolves another contest with a single winner", async () => {
    const newContestId = 2;

    // Create contest
    await creatorSDK.createContest(
      newContestId,
      entryFee,
      "Single Winner Contest",
      feeReceiverWallet.publicKey
    );

    // User 1 enters
    await user1SDK.enterContest(creatorWallet.publicKey, newContestId);

    // User 2 enters
    await user2SDK.enterContest(creatorWallet.publicKey, newContestId);

    // Get initial balances
    const initialUser1Balance = await connection.getBalance(
      user1Wallet.publicKey
    );
    const initialFeeReceiverBalance = await connection.getBalance(
      feeReceiverWallet.publicKey
    );

    // Calculate expected payouts and fee
    const totalPool = entryFee * 2 * LAMPORTS_PER_SOL;
    const feeAmount = totalPool / 10; // 10% fee
    const remainingPool = totalPool - feeAmount;

    // Create winners list with a single winner
    const winners = [
      {
        wallet: user1Wallet.publicKey,
        payout: remainingPool / LAMPORTS_PER_SOL, // 100% of remaining pool
      },
    ];

    // Resolve contest
    await creatorSDK.resolveContest(
      newContestId,
      winners,
      feeReceiverWallet.publicKey
    );

    // Check contest status
    const contest = await creatorSDK.getContest(
      creatorWallet.publicKey,
      newContestId
    );
    expect(contest.status).to.deep.equal({ resolved: {} });

    // Verify balances
    const finalUser1Balance = await connection.getBalance(
      user1Wallet.publicKey
    );
    const finalFeeReceiverBalance = await connection.getBalance(
      feeReceiverWallet.publicKey
    );

    expect(finalUser1Balance).to.be.closeTo(
      initialUser1Balance + remainingPool,
      100000
    );
    expect(finalFeeReceiverBalance).to.be.closeTo(
      initialFeeReceiverBalance + feeAmount,
      100000
    );
  });

  it("Removes an authorized creator", async () => {
    const tx = await adminSDK.removeCreatorAuth(creatorWallet.publicKey);
    expect(tx).to.be.a("string");

    const creators = await adminSDK.getAuthorizedCreators();
    expect(creators).to.be.an("array").that.is.empty;
  });

  it("Unauthorized creator cannot create a contest", async () => {
    try {
      await creatorSDK.createContest(
        3,
        entryFee,
        "Unauthorized Contest",
        feeReceiverWallet.publicKey
      );
      expect.fail("Should have thrown an error");
    } catch (error) {
      expect(error.message).to.include("Failed to create contest");
    }
  });

  // Helper function to airdrop SOL to a wallet
  async function airdropSol(
    connection: Connection,
    publicKey: PublicKey,
    amount: number
  ): Promise<void> {
    const signature = await connection.requestAirdrop(
      publicKey,
      amount * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature);
    console.log(`Airdropped ${amount} SOL to ${publicKey.toString()}`);
  }
});
