import users from "../../../../models/users.ts"
import RequestAddFriend from "../../../../models/reqestAddFriend.ts"
export const handler = {
  async GET(req: Request, ctx: any) {
    try {
      if (!ctx.state.data.loggedIn) {
        return new Response(
          JSON.stringify({ "status": "Please Login" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 401,
          },
        )
      }
      const userFriendInfo = await RequestAddFriend.findOne({
        userID: ctx.state.data.userid.toString(),
      })
      console.log(ctx.state.data.userid.toString())
      if (userFriendInfo == null) {
        return
      }
      const result = await Promise.all(
        userFriendInfo.Applicant.map(async (obj: { userID: any; timestamp: any }) => {
          const userInfo = await users.findOne({ _id: obj.userID });
          if (userInfo == null) {
            return;
          }
          console.log(userInfo);
          return {
            userName: userInfo.userName,
            icon: `./api/v1/friends/${userInfo.userName}/icon?isRequestList=true`,
            timestamp: obj.timestamp,
          };
        })
      );
      return new Response(JSON.stringify({ status: true, result: result }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    } catch (error) {
      console.error("Error in getFriendInfoByID: ", error)
      return new Response(JSON.stringify({ status: "error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      })
    }
  },
}
