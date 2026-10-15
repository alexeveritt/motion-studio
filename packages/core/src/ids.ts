import { v7 as uuidv7 } from "uuid";

/** Time-ordered UUID v7. IDs are assigned once and never change. */
export function newId(): string {
  return uuidv7();
}
