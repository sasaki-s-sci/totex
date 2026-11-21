import "./bridge";

void import("./BrowserCanvas")
  .then(({ start }) => start())
  .catch((error) => {
    const root = document.getElementById("root");
    if (root) {
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = String(error);
      root.replaceChildren(message);
    }
  });
