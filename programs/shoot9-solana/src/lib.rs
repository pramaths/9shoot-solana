use anchor_lang::prelude::*;

declare_id!("6bwskn9KBJyk3tijv33HXtaPjCLkwTDwXzqd5ew5qEGz");

#[program]
pub mod shoot9_solana {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
