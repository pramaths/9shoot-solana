use anchor_lang::prelude::*;
use instructions::*;

pub mod instructions;
pub mod state;
pub mod error;

declare_id!("DjeYpeDdifgrngbyx1hD8t6NpidGRpzpn1RdrMaWNgPd");

#[program]
pub mod shoot9_solana {
    use super::*;

    pub fn initialize_auth(ctx: Context<InitializeAuth>) -> Result<()> {
        initialize_auth::handler_initialize_auth(ctx)
    }

    pub fn update_creator_auth(ctx: Context<UpdateCreatorAuth>, creator: Pubkey) -> Result<()> {
        update_creator_auth::handler_update_creator_auth(ctx, creator)
    }

    pub fn remove_creator_auth(ctx: Context<RemoveCreatorAuth>, creator: Pubkey) -> Result<()> {
        remove_creator_auth::handler_remove_creator_auth(ctx, creator)
    }

    pub fn create_event(ctx: Context<CreateEvent>, event_id: u64, name: String) -> Result<()> {
        create_event::handler_create_event(ctx, event_id, name)
    }

    pub fn create_contest(
        ctx: Context<CreateContest>, 
        contest_id: u64,
        entry_fee: u64, 
        name: String, 
        fee_receiver: Option<Pubkey>
    ) -> Result<()> {
        create_contest::handler_create_contest(ctx, contest_id, entry_fee, name, fee_receiver)
    }

    pub fn enter_contest(ctx: Context<EnterContest>, amount: u64) -> Result<()> {
        enter_contest::handler_enter_contest(ctx, amount)
    }

    pub fn resolve_contest<'a, 'b>(
        ctx: Context<'_, '_, '_, 'b, ResolveContest<'b>>,
        winners: Vec<Pubkey>,
        payouts: Vec<u64>,
    ) -> Result<()> {
        resolve_contest::handler_resolve_contest(ctx, winners, payouts)
    }
}
