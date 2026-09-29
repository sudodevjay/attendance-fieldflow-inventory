/** Error whose message is shown to the user as it is (HTTP 400). */
export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
