export type AccountStatus = "signed-out" | "signing-in" | "signed-in";

// A provider account as Settings shows it. Main reads the status from what is
// stored on this machine and sends the whole list whenever one changes.
export type AccountState = {
  id: string;
  label: string;
  // What the account is for, in English. Provider names are not translated.
  description: string;
  status: AccountStatus;
};
