use crate::state::AuthStore;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeAuth<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + (32 * 100),
        seeds = [b"auth_store"],
        bump
    )]
    pub auth_store: Account<'info, AuthStore>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AuthInitialized {
    pub admin: Pubkey,
    pub timestamp: i64,
}

pub fn handler_initialize_auth(ctx: Context<InitializeAuth>) -> Result<()> {
    let auth_store = &mut ctx.accounts.auth_store;
    auth_store.admin = ctx.accounts.admin.key();
    auth_store.authorized_creators = Vec::new();

    emit!(AuthInitialized {
        admin: ctx.accounts.admin.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
