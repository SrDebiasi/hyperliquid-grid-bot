export async function messageRoutes(app, { models }) {
    const { Message } = models;

    // POST /api/message
    app.post("/message", async (request, reply) => {
        const body = request.body ?? {};
        if (!body.date) body.date = new Date();

        const row = await Message.create(body);
        return reply.code(201).send(row);
    });
}
