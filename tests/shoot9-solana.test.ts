import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Shoot9Solana } from "../target/types/shoot_9_solana";
import { assert } from "chai";

describe("shoot9-solana", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Shoot9Solana as Program<Shoot9Solana>;

  // Derive PDAs
  const [authStorePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("auth_store")],
    program.programId
  );

  // Test wallets
  const admin = provider.wallet.publicKey;
  const creator1 = anchor.web3.Keypair.generate();
  const creator2 = anchor.web3.Keypair.generate();
  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();

  // Airdrop SOL to test accounts
  before(async () => {
    const airdrops = [
      provider.connection.requestAirdrop(creator1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(creator2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
    ];
    await Promise.all(airdrops);
    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it("Should initialize auth store", async () => {
    await program.methods
      .initializeAuth()
      .accountsPartial({
        admin: admin,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.admin.toBase58(), admin.toBase58());
    assert.deepEqual(authStoreAccount.authorizedCreators, []);
  });

  it("Should update creator authorization", async () => {
    await program.methods
      .updateCreatorAuth(creator1.publicKey)
      .accountsPartial({
        admin: admin,
        authStore: authStorePda,
      })
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.authorizedCreators[0].toBase58(), creator1.publicKey.toBase58());
  });

  it("Should create a contest", async () => {
    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        creator1.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8)),
      ],
      program.programId
    );

    await program.methods
      .createContest(
        new anchor.BN(1), // contest_id
        new anchor.BN(anchor.web3.LAMPORTS_PER_SOL), // 1 SOL entry fee
        "Real Madrid vs Barcelona",
        null // no specific fee receiver
      )
      .accountsPartial({
        authority: creator1.publicKey,
        contest: contestPda,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([creator1])
      .rpc();

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    assert.equal(contestAccount.entryFee.toNumber(), anchor.web3.LAMPORTS_PER_SOL);
    assert.equal(contestAccount.contestId.toNumber(), 1);
    assert.equal(contestAccount.name, "Real Madrid vs Barcelona");
    // assert.equal(contestAccount.status, "open"); // Check enum variant
    assert.equal(contestAccount.totalPool.toNumber(), 0);
    assert.deepEqual(contestAccount.participants, []);
  });

  it("Should allow users to enter contest", async () => {
    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        creator1.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8)),
      ],
      program.programId
    );

    // User 1 enters contest
    await program.methods
      .enterContest(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL))
      .accountsPartial({
        user: user1.publicKey,
        contest: contestPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    // User 2 enters contest
    await program.methods
      .enterContest(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL))
      .accountsPartial({
        user: user2.publicKey,
        contest: contestPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    assert.equal(contestAccount.participants.length, 2);
    assert.equal(contestAccount.totalPool.toNumber(), 2 * anchor.web3.LAMPORTS_PER_SOL);
    assert.ok(contestAccount.participants.some((p: anchor.web3.PublicKey) => p.equals(user1.publicKey)));
    assert.ok(contestAccount.participants.some((p: anchor.web3.PublicKey) => p.equals(user2.publicKey)));
  });

  it("Should resolve contest and distribute winnings", async () => {
    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        creator1.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8)),
      ],
      program.programId
    );

    // Only create the winners and payouts we actually need
    const winners = [
      user1.publicKey,
      user2.publicKey
    ];
    
    const payouts = [
      new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.4), // 1st place
      new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.2), // 2nd place
    ];

    const initialBalance1 = await provider.connection.getBalance(user1.publicKey);
    const initialBalance2 = await provider.connection.getBalance(user2.publicKey);
    const initialAdminBalance = await provider.connection.getBalance(admin);

    // Resolve contest - only include the actual winners plus fee receiver in remaining accounts
    await program.methods
      .resolveContest(winners, payouts)
      .accountsPartial({
        authority: creator1.publicKey,
        contest: contestPda,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: user1.publicKey, isWritable: true, isSigner: false },
        { pubkey: user2.publicKey, isWritable: true, isSigner: false },
        { pubkey: admin, isWritable: true, isSigner: false }, // fee receiver
      ])
      .signers([creator1])
      .rpc();

    const finalBalance1 = await provider.connection.getBalance(user1.publicKey);
    const finalBalance2 = await provider.connection.getBalance(user2.publicKey);
    const finalAdminBalance = await provider.connection.getBalance(admin);

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    assert.deepEqual(contestAccount.status, { resolved: {} });

    // Verify payouts (accounting for gas fees, approximate checks)
    const expectedPayout1 = anchor.web3.LAMPORTS_PER_SOL * 0.4;
    const expectedPayout2 = anchor.web3.LAMPORTS_PER_SOL * 0.2;
    const expectedFee = (2 * anchor.web3.LAMPORTS_PER_SOL) / 10; // 10% fee
    assert.approximately(finalBalance1 - initialBalance1, expectedPayout1, 1e6, "User1 payout incorrect");
    assert.approximately(finalBalance2 - initialBalance2, expectedPayout2, 1e6, "User2 payout incorrect");
    assert.approximately(finalAdminBalance - initialAdminBalance, expectedFee, 1e6, "Fee payout incorrect");
  });

  it("Should remove creator authorization", async () => {
    await program.methods
      .removeCreatorAuth(creator1.publicKey)
      .accountsPartial({
        admin: admin,
        authStore: authStorePda,
      })
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.authorizedCreators.length, 0);
  });
});
