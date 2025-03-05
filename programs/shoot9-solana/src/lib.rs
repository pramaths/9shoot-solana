use anchor_lang::prelude::*;
use instructions::*;

pub mod instructions;
pub mod state;

declare_id!("DjeYpeDdifgrngbyx1hD8t6NpidGRpzpn1RdrMaWNgPd");

#[program]
pub mod shoot9_solana {
    use super::*;

    pub fn initialize_auth(ctx: Context<InitializeAuth>) -> Result<()> {
        initialize_auth::handler(ctx)
    }

    pub fn update_creator_auth(ctx: Context<UpdateCreatorAuth>, creator: Pubkey) -> Result<()> {
        update_creator_auth::handler(ctx, creator)
    }

    pub fn remove_creator_auth(ctx: Context<RemoveCreatorAuth>, creator: Pubkey) -> Result<()> {
        remove_creator_auth::handler(ctx, creator)
    }

    pub fn create_event(ctx: Context<CreateEvent>, name: String) -> Result<()> {
        create_event::handler(ctx, name)
    }

    pub fn create_contest(ctx: Context<CreateContest>, entry_fee: u64, name: String, fee_receiver: Option<Pubkey>) -> Result<()> {
        create_contest::handler(ctx, entry_fee, name, fee_receiver)
    }

    pub fn enter_contest(ctx: Context<EnterContest>, amount: u64) -> Result<()> {
        enter_contest::handler(ctx, amount)
    }

    pub fn resolve_contest<'a, 'b>(
        ctx: Context<'_, '_, '_, 'b, ResolveContest<'b>>,
        winners: Vec<Pubkey>,
        payouts: Vec<u64>,
    ) -> Result<()> {
        resolve_contest::handler(ctx, winners, payouts)
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid number of winners")]
    InvalidWinnersCount,
    #[msg("Insufficient pool balance")]
    InsufficientPool,
    #[msg("Invalid contest status")]
    InvalidContestStatus,
    #[msg("Missing winner account")]
    MissingWinnerAccount,
    #[msg("Incorrect entry fee amount")]
    IncorrectAmount,
}
