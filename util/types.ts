export type takojson = {
    status: string;
    requirements: string;
    mail: string;
    password: string;
    userName: string;
}
export type takoresponse = {
  method: string,
  headers: {
    "Content-Type": string,
    "Access-Control-Allow-Origin": string,
  },
  body: {
    status: string;
    requirements: string;
    mail: string;
    password: string;
    userName: string;
    message? : string;
  }
}