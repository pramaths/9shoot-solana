use anchor_lang::prelude::*;
use crate::state::AuthStore;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct UpdateCreatorAuth<'info> {
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
pub struct CreatorAuthorizationUpdated {
    pub creator: Pubkey,
    pub authorized: bool,
    pub timestamp: i64,
}

pub fn handler_update_creator_auth(ctx: Context<UpdateCreatorAuth>, creator: Pubkey) -> Result<()> {
    let auth_store = &mut ctx.accounts.auth_store;
    
    if !auth_store.authorized_creators.contains(&creator) {
        auth_store.authorized_creators.push(creator);
        emit!(CreatorAuthorizationUpdated {
            creator,
            authorized: true,
            timestamp: Clock::get()?.unix_timestamp,
        });
    }
    Ok(())
}
