const service = require("../services/project.service");

module.exports = async function (fastify) {

  fastify.post("/projects", async (req) => {
    return service.createProject(req.body);
  });

  fastify.get("/projects", async () => {
    return service.getProjects();
  });

  fastify.get("/projects/:id", async (req) => {
    return service.getProject(req.params.id);
  });

  fastify.put("/projects/:id", async (req) => {
    return service.updateProject(req.params.id, req.body);
  });

  fastify.delete("/projects/:id", async (req) => {
    return service.deleteProject(req.params.id);
  });

};