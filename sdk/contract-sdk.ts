import * as anchor from "@coral-xyz/anchor";
import { Program, BN, IdlAccounts } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Shoot9Solana } from "../target/types/shoot_9_solana";
import IDL from "../target/idl/shoot_9_solana.json";

export type ContestAccount = IdlAccounts<Shoot9Solana>["contestAccount"];
export type AuthStore = IdlAccounts<Shoot9Solana>["authStore"];

export type Winner = {
  wallet: PublicKey;
  payout: number; // in SOL
};

export class Shoot9SDKError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "Shoot9SDKError";
  }
}

export class Shoot9SDK {
  private readonly connection: Connection;
  private readonly wallet: anchor.Wallet;
  private readonly program: Program<Shoot9Solana>;
  private readonly provider: anchor.AnchorProvider;

  constructor(connection: Connection, wallet: anchor.Wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.provider = new anchor.AnchorProvider(
      connection,
      wallet,
      anchor.AnchorProvider.defaultOptions()
    );
    anchor.setProvider(this.provider);
    this.program = new Program<Shoot9Solana>(
      IDL as Shoot9Solana,
      this.provider
    );
  }

  private async findAuthStorePDA(): Promise<PublicKey> {
    const [authStore] = await PublicKey.findProgramAddress(
      [Buffer.from("auth_store")],
      this.program.programId
    );
    return authStore;
  }

  private async findContestPDA(creator: PublicKey, contestId: number): Promise<PublicKey> {
    const contestIdBuffer = new BN(contestId).toArrayLike(Buffer, "le", 8);
    const [contest] = await PublicKey.findProgramAddress(
      [Buffer.from("contest"), creator.toBuffer(), contestIdBuffer],
      this.program.programId
    );
    return contest;
  }

  public async initializeAuth(): Promise<string> {
    const authStore = await this.findAuthStorePDA();
    console.log("Auth Store PDA:", authStore.toString());

    try {
      const tx = await this.program.methods
        .initializeAuth()
        .accountsStrict({
          admin: this.wallet.publicKey,
          authStore,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, "confirmed");
      return tx;
    } catch (e) {
      console.error("Initialize auth error:", e);
      throw new Shoot9SDKError("Failed to initialize auth", e);
    }
  }

  public async updateCreatorAuth(creator: PublicKey): Promise<string> {
    if (!PublicKey.isOnCurve(creator)) {
      throw new Shoot9SDKError("Invalid creator public key");
    }
    const authStore = await this.findAuthStorePDA();

    try {
      const tx = await this.program.methods
        .updateCreatorAuth(creator)
        .accountsStrict({
          admin: this.wallet.publicKey,
          authStore,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, "confirmed");
      console.log("Added creator:", creator.toString());
      return tx;
    } catch (e) {
      console.error("Update creator auth error:", e);
      throw new Shoot9SDKError("Failed to update creator auth", e);
    }
  }

  public async removeCreatorAuth(creator: PublicKey): Promise<string> {
    if (!PublicKey.isOnCurve(creator)) {
      throw new Shoot9SDKError("Invalid creator public key");
    }
    const authStore = await this.findAuthStorePDA();

    try {
      const beforeAccount = await this.program.account.authStore.fetch(authStore);
      const creatorExists = beforeAccount.authorizedCreators.some((auth) =>
        auth.equals(creator)
      );
      if (!creatorExists) {
        throw new Shoot9SDKError("Creator not found in authorized list");
      }

      const tx = await this.program.methods
        .removeCreatorAuth(creator)
        .accountsStrict({
          admin: this.wallet.publicKey,
          authStore,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, "confirmed");

      const afterAccount = await this.program.account.authStore.fetch(authStore);
      const stillExists = afterAccount.authorizedCreators.some((auth) =>
        auth.equals(creator)
      );
      if (stillExists) {
        throw new Shoot9SDKError("Creator was not successfully removed");
      }

      console.log("Removed creator:", creator.toString());
      return tx;
    } catch (e) {
      console.error("Remove creator auth error:", e);
      throw new Shoot9SDKError(
        e instanceof Shoot9SDKError ? e.message : "Failed to remove creator auth",
        e
      );
    }
  }

  public async createContest(
    contestId: number,
    entryFee: number, // in SOL
    name: string,
    feeReceiver?: PublicKey
  ): Promise<string> {
    const authStore = await this.findAuthStorePDA();
    const contest = await this.findContestPDA(this.wallet.publicKey, contestId);
    const entryFeeLamports = new BN(entryFee * LAMPORTS_PER_SOL);

    try {
      const tx = await this.program.methods
        .createContest(new BN(contestId), entryFeeLamports, name, feeReceiver || null)
        .accountsStrict({
          authority: this.wallet.publicKey,
          contest,
          authStore,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, "confirmed");
      console.log("Contest created:", contest.toString());
      return tx;
    } catch (e) {
      console.error("Create contest error:", e);
      throw new Shoot9SDKError("Failed to create contest", e);
    }
  }

  public async enterContest(
    contestCreator: PublicKey,
    contestId: number
  ): Promise<string> {
    const contest = await this.findContestPDA(contestCreator, contestId);
    const contestAccount = await this.getContest(contestCreator, contestId);

    try {
      const tx = await this.program.methods
        .enterContest(contestAccount.entryFee)
        .accountsStrict({
          user: this.wallet.publicKey,
          contest,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, "confirmed");
      console.log("Entered contest:", contest.toString());
      return tx;
    } catch (e) {
      console.error("Enter contest error:", e);
      throw new Shoot9SDKError("Failed to enter contest", e);
    }
  }

  public async resolveContest(
    contestId: number,
    winners: Winner[],
    feeReceiver: PublicKey
  ): Promise<string> {
    const contest = await this.findContestPDA(this.wallet.publicKey, contestId);
    const authStore = await this.findAuthStorePDA();
  
    // No need to pad winners anymore since we support variable number
    const winnerWallets = winners.map(w => w.wallet);
    const payouts = winners.map(w => new BN(Math.floor(w.payout * LAMPORTS_PER_SOL)));
  
    // Create remaining accounts - winners first, then fee receiver at the end
    const remainingAccounts = [
      ...winnerWallets.map(pubkey => ({
        pubkey,
        isWritable: true,
        isSigner: false,
      })),
      {
        pubkey: feeReceiver,
        isWritable: true,
        isSigner: false,
      },
    ];
  
    try {
      const tx = await this.program.methods
        .resolveContest(winnerWallets, payouts)
        .accountsStrict({
          authority: this.wallet.publicKey,
          contest,
          authStore,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();
  
      await this.connection.confirmTransaction(tx, "confirmed");
  
      const contestAccount = await this.program.account.contestAccount.fetch(contest);
      if (!contestAccount.status.resolved) {
        throw new Shoot9SDKError("Contest was not successfully resolved");
      }
  
      console.log("Resolved contest:", contest.toString());
      return tx;
    } catch (e) {
      console.error("Resolve contest error:", e);
      throw new Shoot9SDKError("Failed to resolve contest", e);
    }
  }

  public async getContest(creator: PublicKey, contestId: number): Promise<ContestAccount> {
    const contest = await this.findContestPDA(creator, contestId);
    try {
      return await this.program.account.contestAccount.fetch(contest);
    } catch (e) {
      console.error("Get contest error:", e);
      throw new Shoot9SDKError("Failed to fetch contest", e);
    }
  }

  public async getAllContests(): Promise<anchor.ProgramAccount<ContestAccount>[]> {
    try {
      return await this.program.account.contestAccount.all();
    } catch (e) {
      console.error("Get all contests error:", e);
      throw new Shoot9SDKError("Failed to fetch all contests", e);
    }
  }

  public async getAuthorizedCreators(): Promise<PublicKey[]> {
    const authStore = await this.findAuthStorePDA();
    try {
      const account = await this.program.account.authStore.fetch(authStore);
      return account.authorizedCreators || [];
    } catch (e) {
      console.error("Get authorized creators error:", e);
      throw new Shoot9SDKError("Failed to fetch authorized creators", e);
    }
  }

  public async getContestParticipants(creator: PublicKey, contestId: number): Promise<PublicKey[]> {
    const contestAccount = await this.getContest(creator, contestId);
    return contestAccount.participants;
  }

  public async getContestPool(creator: PublicKey, contestId: number): Promise<number> {
    const contestAccount = await this.getContest(creator, contestId);
    return Number(contestAccount.totalPool) / LAMPORTS_PER_SOL;
  }
}

export default Shoot9SDK;
