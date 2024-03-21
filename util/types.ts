export type takoreqponseBody = {
  status: string;
  requirements?: string;
  mail?: string;
  password?: string;
  userName?: string;
  message?: string;
};
export type takoresponse = {
  method: string;
  headers: {
    "Content-Type": string;
    "Access-Control-Allow-Origin"?: string;
  };
  body: takoreqponseBody;
};

export type takorequest = {
  userName: string;
  password: string;
  sessionid: string;
  mail: string;
};
//サーバー間通信の時使う
export type talkmassage = {
  to: string;
  from: string;
  token: string;
  body: {
    message: string;
  };
};
/*
export type addfrineds = {

}*/
