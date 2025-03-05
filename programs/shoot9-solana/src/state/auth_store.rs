use anchor_lang::prelude::*;

#[account]
pub struct AuthStore {
    pub admin: Pubkey,
    pub authorized_creators: Vec<Pubkey>,
}