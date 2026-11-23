/**
 * The paper-trading contract, split by domain.
 *
 * Consumers keep importing `../contract.js` (a barrel); a module that only
 * needs one area can import it directly from here.
 * @module @dsh-ft/dsh-fft-paper-trading/contract
 */

export * from './common.ts'
export * from './accounts.ts'
export * from './domain.ts'
export * from './ledger.ts'
export * from './market.ts'
export * from './rpc.ts'
export * from './errors.ts'
