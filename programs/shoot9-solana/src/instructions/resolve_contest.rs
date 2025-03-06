use anchor_lang::prelude::*;
use crate::state::{AuthStore, ContestAccount, ContestStatus};
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct ResolveContest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [
            b"contest",
            contest.authority.as_ref(),
            contest.contest_id.to_le_bytes().as_ref()
        ],
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
    pub contest_id: u64,
    pub winners_count: u64,
    pub total_payout: u64,
    pub fee_receiver: Pubkey,
    pub fee_amount: u64,
    pub timestamp: i64,
}

pub fn handler_resolve_contest<'a, 'b>(
    ctx: Context<'_, '_, '_, 'b, ResolveContest<'b>>,
    winners: Vec<Pubkey>,
    payouts: Vec<u64>,
) -> Result<()> {
    let contest = &mut ctx.accounts.contest;
    
    require!(
        winners.len() == 10 && payouts.len() == 10,
        ErrorCode::InvalidWinnersCount
    );
    require!(
        contest.status == ContestStatus::Open,
        ErrorCode::InvalidContestStatus
    );
    
    let total_payout: u64 = payouts.iter().sum();
    require!(
        total_payout <= contest.total_pool,
        ErrorCode::InsufficientPool
    );
    
    // Calculate 10% fee from total pool
    let fee_amount = contest
        .total_pool
        .checked_div(10)
        .ok_or(ErrorCode::Overflow)?;
    let remaining_pool = contest
        .total_pool
        .checked_sub(fee_amount)
        .ok_or(ErrorCode::Overflow)?;
    require!(total_payout <= remaining_pool, ErrorCode::InsufficientPool);
    
    // Determine fee receiver (use auth_store.admin if None)
    let fee_receiver_key = contest.fee_receiver;
    
    contest.status = ContestStatus::Resolved;
    
    // Ensure we have enough remaining accounts (10 winners + 1 fee receiver)
    require!(
        ctx.remaining_accounts.len() >= 11,
        ErrorCode::MissingWinnerAccount
    );
    
    // Log for debugging
    msg!("Fee receiver: {:?}", fee_receiver_key);
    msg!("Contest PDA: {:?}", contest.key());
    msg!("Remaining accounts len: {:?}", ctx.remaining_accounts.len());
    
    // Transfer fee to fee_receiver (last remaining account)
    let fee_receiver_account = &ctx.remaining_accounts[10]; // Index 10 is fee receiver
    require!(
        fee_receiver_account.key() == fee_receiver_key,
        ErrorCode::MissingWinnerAccount
    );

    msg!("Attempting fee transfer of {} lamports to {:?}", fee_amount, fee_receiver_account.key());
    
    // Get the lamports from the account info
    let contest_account_info = contest.to_account_info();
    let contest_starting_lamports = contest_account_info.lamports();
    
    // Instead of using system_program::transfer which fails with PDAs that have data,
    // directly modify the lamports using lamports() method
    **contest_account_info.try_borrow_mut_lamports()? = contest_starting_lamports.checked_sub(fee_amount).ok_or(ErrorCode::Overflow)?;
    **fee_receiver_account.try_borrow_mut_lamports()? = fee_receiver_account.lamports().checked_add(fee_amount).ok_or(ErrorCode::Overflow)?;
    
    // Transfer SOL to winners using remaining_accounts
    for (i, (&payout, &winner_key)) in payouts.iter().zip(winners.iter()).enumerate() {
        if payout == 0 {
            continue; // Skip zero payouts
        }
        
        let winner_account = &ctx.remaining_accounts[i];
        
        // Verify the account matches the winner's pubkey
        require!(
            winner_account.key() == winner_key,
            ErrorCode::MissingWinnerAccount
        );
        
        // Direct lamport transfer instead of using system program
        let contest_current_lamports = contest_account_info.lamports();
        **contest_account_info.try_borrow_mut_lamports()? = contest_current_lamports.checked_sub(payout).ok_or(ErrorCode::Overflow)?;
        **winner_account.try_borrow_mut_lamports()? = winner_account.lamports().checked_add(payout).ok_or(ErrorCode::Overflow)?;
    }
    
    emit!(ContestResolved {
        contest: contest.key(),
        contest_id: contest.contest_id,
        winners_count: winners.len() as u64,
        total_payout,
        fee_receiver: fee_receiver_key,
        fee_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    
    Ok(())
}
