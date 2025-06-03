// ActivityPub type definitions
export interface Note {
  "@context"?: string | string[];
  id?: string;
  type: "Note";
  content?: string;
  actor?: string;
  to?: string[];
  cc?: string[];
  published?: string;
  attachment?: any[];
  tag?: any[];
}
