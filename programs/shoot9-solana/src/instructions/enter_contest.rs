use anchor_lang::prelude::*;
use crate::state::{ContestAccount, ContestStatus};
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct EnterContest<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"contest", contest.event.as_ref()],
        bump,
        constraint = contest.status == ContestStatus::Open @ ErrorCode::InvalidContestStatus
    )]
    pub contest: Account<'info, ContestAccount>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct ContestEntered {
    pub contest: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

pub fn handler(ctx: Context<EnterContest>, amount: u64) -> Result<()> {
    let contest = &mut ctx.accounts.contest;
    let user = ctx.accounts.user.key();

    // Verify correct entry fee amount
    require!(amount == contest.entry_fee, ErrorCode::IncorrectAmount);

    // Transfer SOL to contest PDA
    let transfer_instruction = anchor_lang::system_program::Transfer {
        from: ctx.accounts.user.to_account_info(),
        to: contest.to_account_info(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_instruction),
        amount
    )?;

    contest.total_pool = contest.total_pool.checked_add(amount).ok_or(ErrorCode::Overflow)?;
    contest.participants.push(user);

    emit!(ContestEntered {
        contest: contest.key(),
        user,
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
