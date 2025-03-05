import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Shoot9Solana } from "../target/types/shoot_9_solana";
import { assert, expect } from "chai";

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
    await Promise.all([
      provider.connection.requestAirdrop(creator1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(creator2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user1.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(user2.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL)
    ]);
  });

  it("Should initialize auth store", async () => {
    const tx = await program.methods
      .initializeAuth()
      .accountsPartial({
        admin: admin,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId
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
        authStore: authStorePda
      })
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(
      authStoreAccount.authorizedCreators[0].toBase58(), 
      creator1.publicKey.toBase58()
    );
  });

  it("Should create an event", async () => {
    const [eventPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("event"), 
        creator1.publicKey.toBuffer(), 
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createEvent(new anchor.BN(1), "Football World Cup 2024")
      .accountsPartial({
        authority: creator1.publicKey,
        event: eventPda,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([creator1])
      .rpc();

    const eventAccount = await program.account.eventAccount.fetch(eventPda);
    assert.equal(eventAccount.name, "Football World Cup 2024");
    assert.equal(eventAccount.eventId.toNumber(), 1);
  });

  it("Should create a contest", async () => {
    const [eventPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("event"), 
        creator1.publicKey.toBuffer(), 
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        eventPda.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    await program.methods
      .createContest(
        new anchor.BN(1),  // contest_id
        new anchor.BN(anchor.web3.LAMPORTS_PER_SOL),  // 1 SOL entry fee
        "Real Madrid vs Barcelona",
        null  // no specific fee receiver
      )
      .accountsPartial({
        authority: creator1.publicKey,
        event: eventPda,
        contest: contestPda,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([creator1])
      .rpc();

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    assert.equal(contestAccount.entryFee.toNumber(), anchor.web3.LAMPORTS_PER_SOL);
    assert.equal(contestAccount.contestId.toNumber(), 1);
  });

  it("Should allow users to enter contest", async () => {
    const [eventPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("event"), 
        creator1.publicKey.toBuffer(), 
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        eventPda.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    // User 1 enters contest
    await program.methods
      .enterContest(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL))
      .accountsPartial({
        user: user1.publicKey,
        contest: contestPda
      })
      .signers([user1])
      .rpc();

    // User 2 enters contest
    await program.methods
      .enterContest(new anchor.BN(anchor.web3.LAMPORTS_PER_SOL))
      .accountsPartial({
        user: user2.publicKey,
        contest: contestPda
      })
      .signers([user2])
      .rpc();

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    assert.equal(contestAccount.participants.length, 2);
    assert.equal(
      contestAccount.totalPool.toNumber(), 
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
  });

  it("Should resolve contest and distribute winnings", async () => {
    const [eventPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("event"), 
        creator1.publicKey.toBuffer(), 
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    const [contestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contest"),
        eventPda.toBuffer(),
        Buffer.from(new anchor.BN(1).toArray("le", 8))
      ],
      program.programId
    );

    // Prepare winners and payouts
    const winners = [
      user1.publicKey, 
      user2.publicKey, 
      ...Array(8).fill(admin)  // Pad with admin for 10 total winners
    ];

    const payouts = [
      new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.4),  // 1st place
      new anchor.BN(anchor.web3.LAMPORTS_PER_SOL * 0.2),  // 2nd place
      ...Array(8).fill(new anchor.BN(0))  // Remaining winners get 0
    ];

    const initialBalance1 = await provider.connection.getBalance(user1.publicKey);
    const initialBalance2 = await provider.connection.getBalance(user2.publicKey);

    // Resolve contest
    await program.methods
      .resolveContest(winners, payouts)
      .accountsPartial({
        authority: creator1.publicKey,
        contest: contestPda,
        authStore: authStorePda,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .remainingAccounts([
        { pubkey: user1.publicKey, isWritable: true, isSigner: false },
        { pubkey: user2.publicKey, isWritable: true, isSigner: false },
        ...Array(8).fill({ pubkey: admin, isWritable: true, isSigner: false }),
        { pubkey: admin, isWritable: true, isSigner: false }  // fee receiver
      ])
      .signers([creator1])
      .rpc();

    const finalBalance1 = await provider.connection.getBalance(user1.publicKey);
    const finalBalance2 = await provider.connection.getBalance(user2.publicKey);

    const contestAccount = await program.account.contestAccount.fetch(contestPda);
    // assert.equal(contestAccount.status, 1);  // Resolved status
  });

  it("Should remove creator authorization", async () => {
    await program.methods
      .removeCreatorAuth(creator1.publicKey)
      .accountsPartial({
        admin: admin,
        authStore: authStorePda
      })
      .rpc();

    const authStoreAccount = await program.account.authStore.fetch(authStorePda);
    assert.equal(authStoreAccount.authorizedCreators.length, 0);
  });
});