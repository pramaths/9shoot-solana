use anchor_lang::prelude::*;

#[account]
pub struct ContestAccount {
    pub authority: Pubkey,
    pub contest_id: u64,
    pub name: String,
    pub entry_fee: u64,
    pub fee_receiver: Pubkey,
    pub status: ContestStatus,
    pub total_pool: u64,
    pub participants: Vec<Pubkey>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContestStatus {
    Open,
    Resolved,
    Cancelled,
}
