type NoteWithReference = {
  reference?: string; // Standard code reference, e.g., "ACI 318-19 Section 10.4.3"
  message: string;
};

export type Warnings = Array<NoteWithReference>;

export type calculationResult = {
  [key: string]: any;
  warnings: Warnings; // Shall be empty if no warnings
};
