/** Labels of the profile fields (own details + HR profile), in the order the profile screens show them. */
export const FIELD_LABELS: Record<string, string> = {
  Phone: 'Mobile', Email: 'Email', HomeAddress: 'Address', PersonalEmail: 'Personal email', BloodGroup: 'Blood group',
  MaritalStatus: 'Marital status', EmergencyName: 'Emergency contact', EmergencyRelation: 'Relation', EmergencyPhone: 'Emergency phone',
  Pan: 'PAN', Aadhaar: 'Aadhaar', Uan: 'UAN', PfNo: 'PF No', EsiNo: 'ESI No', BankName: 'Bank', AccountHolder: 'Account holder',
  BankAccount: 'Account no', BankIfsc: 'IFSC',
};

/** Shown masked by the server: never pre-filled, sent only when typed. */
export const MASKED = ['Aadhaar', 'BankAccount'];
