use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::{AuthStore, EventAccount, ContestAccount, ContestStatus};
use crate::ErrorCode;

#[derive(Accounts)]
pub struct CreateContest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub event: Account<'info, EventAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 1 + 8 + (32 * 1000) + 1,
        seeds = [b"contest", event.key().as_ref()],
        bump
    )]
    pub contest: Account<'info, ContestAccount>,
    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = contest,
    )]
    pub contest_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, anchor_spl::token::Mint>,
    #[account(
        seeds = [b"auth_store"],
        bump,
        constraint = auth_store.authorized_creators.contains(&authority.key()) @ ErrorCode::Unauthorized
    )]
    pub auth_store: Account<'info, AuthStore>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct ContestCreated {
    pub contest: Pubkey,
    pub event: Pubkey,
    pub entry_fee: u64,
    pub name: String,
    pub timestamp: i64,
}

pub fn handler(ctx: Context<CreateContest>, entry_fee: u64, name: String) -> Result<()> {
    let contest = &mut ctx.accounts.contest;
    contest.authority = ctx.accounts.authority.key();
    contest.event = ctx.accounts.event.key();
    contest.entry_fee = entry_fee;
    contest.status = ContestStatus::Open;
    contest.total_pool = 0;
    contest.participants = Vec::new();
    contest.bump = ctx.bumps.contest;

    emit!(ContestCreated {
        contest: contest.key(),
        event: contest.event,
        entry_fee,
        name,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}