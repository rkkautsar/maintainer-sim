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
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function renderPreviewArt(pack) {
  const art = el("div", null, "scene-art");
  const window = el("div", null, "mock-window");
  const top = el("div", null, "mock-top");
  const preview = pack.preview ?? { title: pack.title, items: [] };
  top.append(
    document.createTextNode(preview.title),
    el("span", "YOUR COMMUNITY"),
  );
  window.append(top);

  for (const item of preview.items ?? []) {
    const row = el("div", null, "mock-row");
    const vote = el("div", "↑ 12", "mock-vote");
    const description = document.createElement("div");
    description.append(el("strong", item.title), el("small", item.detail));
    row.append(vote, description);
    window.append(row);
  }

  art.append(window);
  return art;
}

function renderTags(pack) {
  const tags = el("div", null, "tags");
  for (const text of [
    pack.stages + " stages",
    pack.prs + " contributions",
    "Prepared revisions",
  ]) {
    tags.append(el("span", text));
  }
  return tags;
}

function renderConnection(session) {
  const connect = el("a", "Connect GitHub to play", "button");
  connect.href = "/auth/start";
  if (!session.ready) {
    connect.removeAttribute("href");
    connect.setAttribute("aria-disabled", "true");
  }
  return connect;
}

function renderRepositoryForm(pack) {
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
  form.onsubmit = (event) =>
    launchScenario(event, { pack, name, select, button, form });
  return form;
}

async function launchScenario(event, { pack, name, select, button, form }) {
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
}

function renderScenarioActions(content, pack, session) {
  if (!session.user) {
    if (!session.ready) {
      content.append(
        el(
          "p",
          "GitHub connection is being configured. You can explore the scenario preview below.",
          "fine",
        ),
      );
    }
    content.append(renderConnection(session));
    return;
  }

  content.append(
    el("p", "Connected as " + session.user.login, "fine"),
    renderRepositoryForm(pack),
    el(
      "p",
      "Creates a new repository in your personal account. Your existing repositories are not changed.",
      "fine",
    ),
  );
}

function renderScenarioCard(pack, session) {
  const card = el("section", null, "scenario");
  card.dataset.scenario = pack.id;
  const content = el("div", null, "scene-content");
  content.append(
    el("span", "COMMUNITY SOFTWARE", "badge"),
    el("h2", pack.title),
    el("p", pack.description, "description"),
    renderTags(pack),
  );
  renderScenarioActions(content, pack, session);

  const previewLink = el("a", "Explore the starting app files ↗", "fine");
  previewLink.href = "/scenarios/" + pack.id + "/" + pack.version + "/preview";
  previewLink.classList.add("preview-link");
  content.append(previewLink);
  card.append(renderPreviewArt(pack), content);
  return card;
}

async function load() {
  try {
    session = await call("/api/session");
    const packs = await call("/api/scenarios");
    const catalog = $("catalog");
    catalog.replaceChildren();
    for (const pack of packs) {
      catalog.append(renderScenarioCard(pack, session));
    }
    if (session.user) watch();
  } catch (error) {
    $("error").textContent = error.message;
  }
}

function scenarioForm(job) {
  const card = Array.from(document.querySelectorAll(".scenario")).find(
    (candidate) => candidate.dataset.scenario === job.scenario,
  );
  return card?.querySelector("form");
}

function updateScenarioButton(form, job) {
  if (!form) return;
  form.after($("progress"));
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

function renderJobLinks(box, job) {
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
}

function renderRetry(box) {
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

function renderJob(box, job) {
  box.hidden = false;
  box.replaceChildren(el("h3", job.title), el("p", job.message));
  renderJobLinks(box, job);
  if (["waiting-access", "failed"].includes(job.state)) renderRetry(box);
  if (!["ready", "failed", "waiting-access"].includes(job.state)) {
    poll = setTimeout(watch, 3000);
  }
}

function renderWatchError(error) {
  $("error").textContent = error.message;
  const retry = el("button", "Check setup again", "secondary");
  retry.onclick = () => watch();
  const box = $("progress");
  box.hidden = false;
  box.replaceChildren(
    el("h3", "Could not check setup"),
    el(
      "p",
      "Your repository has been preserved. Check again to see its progress.",
    ),
    retry,
  );
}

async function watch() {
  clearTimeout(poll);
  try {
    const job = await call("/api/launch/status");
    if (!job.id) return;
    const box = $("progress");
    updateScenarioButton(scenarioForm(job), job);
    renderJob(box, job);
  } catch (error) {
    renderWatchError(error);
  }
}

load();
