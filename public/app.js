const $ = (id) => document.getElementById(id);
let session;
let poll;

async function call(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "content-type": "application/json", "x-csrf-token": session.csrf }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error || "Something went wrong. Try again.");
  return data;
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

async function load() {
  try {
    session = await call("/api/session");
    const packs = await call("/api/scenarios");
    $("catalog").replaceChildren();
    for (const pack of packs) {
      const card = el("section", null, "scenario");
      card.dataset.scenario = pack.id;
      const art = el("div", null, "scene-art");
      art.innerHTML =
        '<div class="mock-window"><div class="mock-top">forum<span>YOUR COMMUNITY</span></div><div class="mock-row"><div class="mock-vote">↑ 12</div><div><strong>What are you working on this weekend?</strong><small>Maya · 8 comments</small></div></div><div class="mock-row"><div class="mock-vote">↑ 7</div><div><strong>Moving out of the group chat</strong><small>Priya · 14 comments</small></div></div><div class="mock-row"><div class="mock-vote">↑ 4</div><div><strong>Show us your desk setup</strong><small>Sam · 5 comments</small></div></div></div>';
      const content = el("div", null, "scene-content");
      content.append(
        el("span", "COMMUNITY SOFTWARE", "badge"),
        el("h2", pack.title),
        el("p", pack.description, "description"),
      );
      const tags = el("div", null, "tags");
      for (const t of [
        pack.stages + " stages",
        pack.prs + " contributions",
        "Prepared revisions",
      ])
        tags.append(el("span", t));
      content.append(tags);
      if (!session.user) {
        const connect = el("a", "Connect GitHub to play", "button");
        connect.href = "/auth/start";
        if (!session.ready) {
          connect.removeAttribute("href");
          connect.setAttribute("aria-disabled", "true");
          content.append(
            el(
              "p",
              "GitHub connection is being configured. You can explore the scenario preview below.",
              "fine",
            ),
          );
        }
        content.append(connect);
      } else {
        const account = el("p", "Connected as " + session.user.login, "fine");
        const form = el("form");
        const nameLabel = el("label", "Repository name");
        const name = el("input");
        name.name = "name";
        name.placeholder = "maintainer-sim-" + pack.id;
        name.pattern = "[A-Za-z0-9][A-Za-z0-9_.-]{0,79}";
        name.maxLength = 80;
        nameLabel.append(name);
        const visibility = el("label", "Visibility");
        const select = el("select");
        for (const value of ["private", "public"]) {
          const option = el(
            "option",
            value === "private"
              ? "Private — only you and the App"
              : "Public — share your playthrough",
          );
          option.value = value;
          select.append(option);
        }
        visibility.append(select);
        const button = el("button", "Create my playthrough");
        form.append(nameLabel, visibility, button);
        form.onsubmit = async (event) => {
          event.preventDefault();
          button.disabled = true;
          button.textContent = "Preparing your playthrough…";
          $("error").textContent = "";
          const box = $("progress");
          form.after(box);
          box.hidden = false;
          box.replaceChildren(
            el("h3", "Preparing your playthrough"),
            el(
              "p",
              "Creating your repository and inviting the contributors. This can take a minute or two.",
            ),
          );
          box.scrollIntoView({ block: "nearest", behavior: "smooth" });
          try {
            await call("/api/launch", {
              scenario: pack.id,
              version: pack.version,
              name: name.value,
              private: select.value === "private",
            });
            watch();
          } catch (error) {
            $("error").textContent = error.message;
            button.disabled = false;
            button.textContent = "Create my playthrough";
          }
        };
        content.append(
          account,
          form,
          el(
            "p",
            "Creates a new repository in your personal account. Your existing repositories are not changed.",
            "fine",
          ),
        );
      }
      const preview = el("a", "Explore the starting app files ↗", "fine");
      preview.href = "/scenarios/" + pack.id + "/" + pack.version + "/preview";
      preview.classList.add("preview-link");
      content.append(preview);
      card.append(art, content);
      $("catalog").append(card);
    }
    if (session.user) watch();
  } catch (error) {
    $("error").textContent = error.message;
  }
}

async function watch() {
  clearTimeout(poll);
  try {
    const job = await call("/api/launch/status");
    if (!job.id) return;
    const box = $("progress");
    const card = Array.from(document.querySelectorAll(".scenario")).find(
      (card) => card.dataset.scenario === job.scenario,
    );
    const form = card?.querySelector("form");
    if (form) {
      form.after(box);
      const button = form.querySelector("button");
      button.disabled = job.state !== "ready";
      button.textContent =
        job.state === "ready"
          ? "Create another playthrough"
          : job.state === "failed"
            ? "Setup needs attention"
            : job.state === "waiting-access"
              ? "Waiting for GitHub access"
              : "Preparing your playthrough…";
    }
    box.hidden = false;
    box.replaceChildren(el("h3", job.title), el("p", job.message));
    if (job.url) {
      const link = el(
        "a",
        job.state === "ready"
          ? "Start playing — open Game Master issue #1 ↗"
          : "Open repository ↗",
        "button",
      );
      link.href = job.url;
      box.append(link);
    }
    if (job.installUrl) {
      const link = el("a", "Install or update GitHub access", "button");
      link.href = job.installUrl;
      box.append(link);
    }
    if (["waiting-access", "failed"].includes(job.state)) {
      const retry = el("button", "Try again", "secondary");
      retry.onclick = async () => {
        retry.disabled = true;
        try {
          await call("/api/launch/retry", {});
          await watch();
        } catch (error) {
          $("error").textContent = error.message;
          retry.disabled = false;
        }
      };
      box.append(document.createTextNode(" "), retry);
    }
    if (!["ready", "failed", "waiting-access"].includes(job.state))
      poll = setTimeout(watch, 3000);
  } catch (error) {
    $("error").textContent = error.message;
    const retry = el("button", "Check setup again", "secondary");
    retry.onclick = () => watch();
    $("progress").hidden = false;
    $("progress").replaceChildren(
      el("h3", "Could not check setup"),
      el(
        "p",
        "Your repository has been preserved. Check again to see its progress.",
      ),
      retry,
    );
  }
}

load();
