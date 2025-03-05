use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid number of winners")]
    InvalidWinnersCount,
    #[msg("Insufficient pool balance")]
    InsufficientPool,
    #[msg("Invalid contest status")]
    InvalidContestStatus,
    #[msg("Missing winner account")]
    MissingWinnerAccount,
    #[msg("Incorrect entry fee amount")]
    IncorrectAmount,
}