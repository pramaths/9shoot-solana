use anchor_lang::prelude::*;
use crate::state::AuthStore;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct RemoveCreatorAuth<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"auth_store"],
        bump,
        constraint = auth_store.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub auth_store: Account<'info, AuthStore>,
}

#[event]
pub struct CreatorAuthorizationRemoved {
    pub creator: Pubkey,
    pub authorized: bool,
    pub timestamp: i64,
}

pub fn handler_remove_creator_auth(ctx: Context<RemoveCreatorAuth>, creator: Pubkey) -> Result<()> {
    let auth_store = &mut ctx.accounts.auth_store;
    
    if let Some(index) = auth_store.authorized_creators.iter().position(|x| *x == creator) {
        auth_store.authorized_creators.remove(index);
        emit!(CreatorAuthorizationRemoved {
            creator,
            authorized: false,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }
    Ok(())
}
