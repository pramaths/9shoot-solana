use anchor_lang::prelude::*;
use crate::state::{AuthStore, EventAccount, EventStatus};
use crate::error::ErrorCode;

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 4 + 100 + 1 + 1,
        seeds = [b"event", authority.key().as_ref(), event_id.to_le_bytes().as_ref()],
        bump
    )]
    pub event: Account<'info, EventAccount>,
    #[account(
        seeds = [b"auth_store"],
        bump,
        constraint = auth_store.authorized_creators.contains(&authority.key()) @ ErrorCode::Unauthorized
    )]
    pub auth_store: Account<'info, AuthStore>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct EventCreated {
    pub event: Pubkey,
    pub event_id: u64,
    pub name: String,
    pub authority: Pubkey,
    pub timestamp: i64,
}

pub fn handler(ctx: Context<CreateEvent>, event_id: u64, name: String) -> Result<()> {
    let event = &mut ctx.accounts.event;
    event.authority = ctx.accounts.authority.key();
    event.event_id = event_id;
    event.name = name;
    event.status = EventStatus::Upcoming;
    event.bump = ctx.bumps.event;

    emit!(EventCreated {
        event: event.key(),
        event_id,
        name: event.name.clone(),
        authority: event.authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
