use anchor_lang::prelude::*;
use crate::state::{AuthStore, ContestAccount, ContestStatus};
use crate::ErrorCode;

#[derive(Accounts)]
pub struct ResolveContest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"contest", contest.event.as_ref()],
        bump,
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
pub struct ContestResolved {
    pub contest: Pubkey,
    pub winners_count: u64,
    pub total_payout: u64,
    pub timestamp: i64,
}

pub fn handler(ctx: Context<ResolveContest>, winners: Vec<Pubkey>, payouts: Vec<u64>) -> Result<()> {
    let contest = &mut ctx.accounts.contest;
    
    require!(winners.len() == 10 && payouts.len() == 10, ErrorCode::InvalidWinnersCount);
    require!(contest.status == ContestStatus::Open, ErrorCode::InvalidContestStatus);

    let total_payout: u64 = payouts.iter().sum();
    require!(total_payout <= contest.total_pool, ErrorCode::InsufficientPool);

    contest.status = ContestStatus::Resolved;

    // Transfer SOL to winners
    for (winner, &payout) in winners.iter().zip(payouts.iter()) {
        let seeds = &[b"contest", contest.event.as_ref(), &[contest.bump]];
        let signer = &[&seeds[..]];

        let transfer_instruction = anchor_lang::system_program::Transfer {
            from: ctx.accounts.contest.to_account_info(),
            to: winner.to_account_info(),
        };
        
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_instruction,
                signer
            ),
            payout
        )?;
    }

    emit!(ContestResolved {
        contest: contest.key(),
        winners_count: winners.len() as u64,
        total_payout,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
