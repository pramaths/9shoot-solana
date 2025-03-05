use anchor_lang::prelude::*;
use crate::state::{AuthStore, ContestAccount, ContestStatus};
use crate::error::ErrorCode;

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
    pub fee_receiver: Pubkey,
    pub fee_amount: u64,
    pub timestamp: i64,
}

pub fn handler<'a, 'b>(
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

    // Prepare seeds for PDA signing
    let seeds = &[b"contest", contest.event.as_ref(), &[contest.bump]];
    let signer = &[&seeds[..]];

    // Transfer fee to fee_receiver (last remaining account)
    let fee_receiver_account = &ctx.remaining_accounts[10]; // Index 10 is fee receiver
    require!(
        fee_receiver_account.key() == fee_receiver_key,
        ErrorCode::MissingWinnerAccount
    );
    let fee_transfer_instruction = anchor_lang::system_program::Transfer {
        from: contest.to_account_info(),
        to: fee_receiver_account.to_account_info(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            fee_transfer_instruction,
            signer,
        ),
        fee_amount,
    )?;

    // Transfer SOL to winners using remaining_accounts
    for (i, (&payout, &winner_key)) in payouts.iter().zip(winners.iter()).enumerate() {
        let winner_account = &ctx.remaining_accounts[i];

        // Verify the account matches the winner's pubkey
        require!(
            winner_account.key() == winner_key,
            ErrorCode::MissingWinnerAccount
        );

        let transfer_instruction = anchor_lang::system_program::Transfer {
            from: contest.to_account_info(),
            to: winner_account.to_account_info(),
        };

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                transfer_instruction,
                signer,
            ),
            payout,
        )?;
    }

    emit!(ContestResolved {
        contest: contest.key(),
        winners_count: winners.len() as u64,
        total_payout,
        fee_receiver: fee_receiver_key,
        fee_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
