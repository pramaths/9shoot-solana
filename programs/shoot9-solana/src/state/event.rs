use anchor_lang::prelude::*;

#[account]
pub struct EventAccount {
    pub authority: Pubkey,
    pub name: String,
    pub status: EventStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventStatus {
    Upcoming,
    Live,
    Open,
    Cancelled,
    Suspended,
}
