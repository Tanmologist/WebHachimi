import type { ProjectStore, CreateTransactionInput } from "../project/projectStore";
import type { Transaction } from "../project/schema";
import type { Result } from "../shared/types";

export type EditorTransactionControllerDeps = {
  store: ProjectStore;
  syncWorldFromStore: () => void;
  markProjectDirty: (reason: string) => void;
};

export type EditorTransactionInput = CreateTransactionInput & {
  dirtyReason?: string;
  syncOnSuccess?: boolean;
  syncOnFailure?: boolean;
};

export class EditorTransactionController {
  constructor(private readonly deps: EditorTransactionControllerDeps) {}

  apply(input: EditorTransactionInput): Result<Transaction> {
    const {
      dirtyReason,
      syncOnSuccess = true,
      syncOnFailure = true,
      ...transactionInput
    } = input;
    const transaction = this.deps.store.createTransaction(transactionInput);
    const result = this.deps.store.apply(transaction);
    if (result.ok) {
      if (syncOnSuccess) this.deps.syncWorldFromStore();
      if (dirtyReason) this.deps.markProjectDirty(dirtyReason);
    } else if (syncOnFailure) {
      this.deps.syncWorldFromStore();
    }
    return result;
  }
}
