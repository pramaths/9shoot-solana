use anchor_lang::prelude::*;
use crate::state::{AuthStore, EventAccount, ContestAccount, ContestStatus};
use crate::error::ErrorCode;

#[derive(Accounts)]
#[instruction(contest_id: u64)]
pub struct CreateContest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"event", authority.key().as_ref(), event.event_id.to_le_bytes().as_ref()],
        bump
    )]
    pub event: Account<'info, EventAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 8 + 1 + 8 + (32 * 1000) + 1 + 33,
        seeds = [
            b"contest", 
            event.key().as_ref(), 
            contest_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub contest: Account<'info, ContestAccount>,
    #[account(
        seeds = [b"auth_store"],
        bump,
        constraint = auth_store.authorized_creators.contains(&authority.key()) @ ErrorCode::Unauthorized
    )]
    pub auth_store: Account<'info, AuthStore>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct ContestCreated {
    pub contest: Pubkey,
    pub contest_id: u64,
    pub event: Pubkey,
    pub entry_fee: u64,
    pub name: String,
    pub fee_receiver: Pubkey,
    pub timestamp: i64,
}

pub fn handler_create_contest(
    ctx: Context<CreateContest>, 
    contest_id: u64,
    entry_fee: u64, 
    name: String, 
    fee_receiver: Option<Pubkey>
) -> Result<()> {
    let contest = &mut ctx.accounts.contest;
    contest.authority = ctx.accounts.authority.key();
    contest.event = ctx.accounts.event.key();
    contest.contest_id = contest_id;
    contest.entry_fee = entry_fee;
    contest.status = ContestStatus::Open;
    contest.total_pool = 0;
    contest.participants = Vec::new();
    contest.fee_receiver = fee_receiver.unwrap_or(ctx.accounts.auth_store.admin);
    contest.bump = ctx.bumps.contest;

    emit!(ContestCreated {
        contest: contest.key(),
        contest_id,
        event: contest.event,
        entry_fee,
        name,
        fee_receiver: contest.fee_receiver,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
