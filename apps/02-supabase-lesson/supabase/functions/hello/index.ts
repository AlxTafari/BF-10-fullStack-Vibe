Deno.serve((req: Request) => {
    return new Response(
        JSON.stringify({message: "hello, it-ncubator, studentId: 5752"}),
        {headers: {"Content-Type": "application/json"}},
    );

});
