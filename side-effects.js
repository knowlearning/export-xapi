    const matchingOp = patch.find(({path}) => {
      return path.length === 3 && path[0] === 'llm' && path[1] === 'messages'
    })

    if (!matchingOp) return

    const { llm } = await Agent.state(scope, user, domain)

    if (llm && matchingOp.value?.role === 'user') {
      const { secrets: { OPENAI_API_KEY } } = await Agent.environment()
      return await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            ...llm,
            messages: [ ...llm.messages, matchingOp.value ]
          })
        })
        .then(r => r.json())
    }
 