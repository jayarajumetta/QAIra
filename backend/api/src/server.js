const app = require("./app");

app.listen({ port: 3000, host: "0.0.0.0" })
  .then(() => console.log("API running"))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });