let users = [],
  features = {},
  offset = 0;
const size = 2,
  $ = (id) => document.getElementById(id);
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-demo-user": $("user").value,
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
function status(message = "") {
  $("status").textContent = message;
}
async function load() {
  try {
    features = await api("/api/features");
    $("features").textContent = ["Likes", "Editing", "Pagination"]
      .map(
        (name, i) =>
          name +
          ": " +
          (features[["likes", "editing", "pagination"][i]]
            ? "available"
            : "coming in this milestone"),
      )
      .join(" · ");
    const posts = await api(
      "/api/posts" +
        (features.pagination ? "?offset=" + offset + "&limit=" + size : ""),
    );
    $("posts").replaceChildren();
    for (const post of posts) {
      const card = document.createElement("article"),
        title = document.createElement("h2"),
        by = document.createElement("small"),
        actions = document.createElement("div");
      title.textContent = post.title;
      by.textContent =
        "Posted by " +
        (users.find((u) => u.id === post.ownerId)?.name ?? post.ownerId);
      actions.className = "actions";
      const like = document.createElement("button");
      like.textContent = "Like · " + post.likedBy.length;
      like.disabled = !features.likes;
      like.onclick = () =>
        action(() =>
          api("/api/posts/" + post.id + "/likes", {
            method: "POST",
            body: "{}",
          }),
        );
      actions.append(like);
      if (post.ownerId === $("user").value) {
        const edit = document.createElement("button");
        edit.textContent = "Edit";
        edit.disabled = !features.editing;
        edit.onclick = () => {
          const title = prompt("Edit your notice", post.title);
          if (title !== null)
            action(() =>
              api("/api/posts/" + post.id, {
                method: "PATCH",
                body: JSON.stringify({ title }),
              }),
            );
        };
        actions.append(edit);
      }
      card.append(title, by, actions);
      $("posts").append(card);
    }
    if (!posts.length) $("posts").textContent = "No notices on this page.";
    $("previous").disabled = !features.pagination || offset === 0;
    $("next").disabled = !features.pagination || posts.length < size;
    $("page-label").textContent = features.pagination
      ? "Page " + (offset / size + 1)
      : "All notices";
  } catch (error) {
    status(error.message);
  }
}
async function action(fn) {
  try {
    await fn();
    status();
    await load();
  } catch (error) {
    status(error.message);
  }
}
$("create").onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ title: $("title").value }),
    });
    $("title").value = "";
    offset = 0;
  });
};
$("user").onchange = () => load();
$("previous").onclick = () => {
  offset = Math.max(0, offset - size);
  load();
};
$("next").onclick = () => {
  offset += size;
  load();
};
(async () => {
  try {
    users = await api("/api/users");
    for (const user of users) {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name;
      $("user").append(option);
    }
    await load();
  } catch (error) {
    status(error.message);
  }
})();
