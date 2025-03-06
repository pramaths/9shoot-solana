import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Shoot9Solana } from "../target/types/shoot_9_solana";
import { assert } from "chai";
import { getKeypairFromFile } from "@solana-developers/helpers";

describe("shoot9-solana", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Shoot9Solana as Program<Shoot9Solana>;

  // Derive PDAs (will use await for admin later)
  const [authStorePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("auth_store")],
    program.programId
  );

  // Test wallets
  const adminPromise = getKeypairFromFile("/home/ritikbhatt020/.config/solana/id.json");
  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();

  // Since admin is a Promise, we’ll resolve it in before() and use it globally
  let admin: anchor.web3.Keypair;

  before(async () => {
    admin = await adminPromise;

    // Update provider to use admin keypair
    const wallet = new anchor.Wallet(admin);
    const updatedProvider = new anchor.AnchorProvider(provider.connection, wallet, provider.opts);
    anchor.setProvider(updatedProvider);

    // Airdrop SOL to test accounts
    const airdrops = [
      provider.connection.requestAirdrop(admin.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
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
        admin: admin.publicKey,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.admin.toBase58(), admin.publicKey.toBase58());
    assert.deepEqual(authStoreAccount.authorizedCreators, []);
  });

  it("Should update creator authorization for admin", async () => {
    await program.methods
      .updateCreatorAuth(admin.publicKey)
      .accountsPartial({
        admin: admin.publicKey,
        authStore: authStorePda,
      })
      .signers([admin])
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.authorizedCreators[0].toBase58(), admin.publicKey.toBase58());
  });

  it("Should create a contest with admin", async () => {
    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        admin.publicKey.toBuffer(),
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
        authority: admin.publicKey,
        contest: contestPda,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    assert.equal(contestAccount.entryFee.toNumber(), anchor.web3.LAMPORTS_PER_SOL);
    assert.equal(contestAccount.contestId.toNumber(), 1);
    assert.equal(contestAccount.name, "Real Madrid vs Barcelona");
    // assert.equal(contestAccount.status, "open");
    assert.equal(contestAccount.totalPool.toNumber(), 0);
    assert.deepEqual(contestAccount.participants, []);
  });

  it("Should allow users to enter contest", async () => {
    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        admin.publicKey.toBuffer(),
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
        admin.publicKey.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8)),
      ],
      program.programId
    );

    const winners = [user1.publicKey, user2.publicKey, ...Array(8).fill(admin.publicKey)];
    const payouts = [
      new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.9), // 0.9 SOL to user1
      new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.9), // 0.9 SOL to user2
      ...Array(8).fill(new anchor.BN(0)),
    ];

    const initialBalance1 = await provider.connection.getBalance(user1.publicKey);
    const initialBalance2 = await provider.connection.getBalance(user2.publicKey);
    const initialAdminBalance = await provider.connection.getBalance(admin.publicKey);

    try {
      await program.methods
        .resolveContest(winners, payouts)
        .accountsPartial({
          authority: admin.publicKey,
          contest: contestPda,
          authStore: authStorePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: user1.publicKey, isWritable: true, isSigner: false }, // Winner 0
          { pubkey: user2.publicKey, isWritable: true, isSigner: false }, // Winner 1
          ...Array(8).fill({ pubkey: admin.publicKey, isWritable: true, isSigner: false }), // Winners 2-9
          { pubkey: admin.publicKey, isWritable: true, isSigner: false }, // Fee receiver (index 10)
        ])
        .signers([admin])
        .rpc();
    } catch (err) {
      console.log("Transaction failed:", err);
      console.log("Logs:", err.logs);
      throw err;
    }

    const finalBalance1 = await provider.connection.getBalance(user1.publicKey);
    const finalBalance2 = await provider.connection.getBalance(user2.publicKey);
    const finalAdminBalance = await provider.connection.getBalance(admin.publicKey);

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    // assert.equal(contestAccount.status, "resolved");

    const expectedPayout1 = anchor.web3.LAMPORTS_PER_SOL * 0.9;
    const expectedPayout2 = anchor.web3.LAMPORTS_PER_SOL * 0.9;
    const expectedFee = (2 * anchor.web3.LAMPORTS_PER_SOL) / 10; // 0.2 SOL
    assert.approximately(finalBalance1 - initialBalance1, expectedPayout1, 1e6, "User1 payout incorrect");
    assert.approximately(finalBalance2 - initialBalance2, expectedPayout2, 1e6, "User2 payout incorrect");
    assert.approximately(finalAdminBalance - initialAdminBalance, expectedFee, 1e6, "Fee payout incorrect");
  });

  it("Should remove creator authorization", async () => {
    await program.methods
      .removeCreatorAuth(admin.publicKey)
      .accountsPartial({
        admin: admin.publicKey,
        authStore: authStorePda,
      })
      .signers([admin])
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.authorizedCreators.length, 0);
  });
});
