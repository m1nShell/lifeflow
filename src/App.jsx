import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";

const STORAGE_KEY = "lifeflow:mvp";

const defaultData = {
  categories: [
    {
      id: uuidv4(),
      name: "Personal",
      color: "#7c8cff",
      visible: true,
    },
  ],
  flows: [],
  tasks: [],
};

const defaultViewport = { x: 0, y: 0, zoom: 1 };

const stateOrder = ["not_started", "in_progress", "done"];

function nextState(state) {
  const index = stateOrder.indexOf(state);
  return stateOrder[(index + 1) % stateOrder.length];
}

function loadInitialState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      data: defaultData,
      viewport: defaultViewport,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.data?.categories) {
      throw new Error("invalid data");
    }
    return {
      data: parsed.data,
      viewport: parsed.viewport ?? defaultViewport,
    };
  } catch (error) {
    console.error("Failed to load saved data", error);
    return {
      data: defaultData,
      viewport: defaultViewport,
    };
  }
}

function getCategoryById(categories, id) {
  return categories.find((category) => category.id === id);
}

function hasCycle(tasks, sourceId, targetId) {
  const visited = new Set();
  const stack = [targetId];
  while (stack.length) {
    const current = stack.pop();
    if (current === sourceId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const task = tasks.find((item) => item.id === current);
    if (task) {
      stack.push(...task.dependencies);
    }
  }
  return false;
}

function isBlocked(task, tasksById) {
  return task.dependencies.some((depId) => tasksById[depId]?.state !== "done");
}

export default function App() {
  const [appState, setAppState] = useState(loadInitialState);
  const [activeCategoryId, setActiveCategoryId] = useState(
    appState.data.categories[0]?.id ?? null
  );
  const [activeFlowId, setActiveFlowId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [panState, setPanState] = useState(null);

  const svgRef = useRef(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }, [appState]);

  const { data, viewport } = appState;

  const tasksById = useMemo(() => {
    return data.tasks.reduce((accumulator, task) => {
      accumulator[task.id] = task;
      return accumulator;
    }, {});
  }, [data.tasks]);

  const visibleCategories = data.categories.filter((category) => category.visible);

  const filteredTasks = data.tasks.filter((task) => {
    const categoryVisible = visibleCategories.some(
      (category) => category.id === task.categoryId
    );
    if (!categoryVisible) {
      return false;
    }
    if (activeFlowId) {
      return task.flowId === activeFlowId;
    }
    if (activeCategoryId) {
      return task.categoryId === activeCategoryId;
    }
    return true;
  });

  const flowOptions = data.flows.filter(
    (flow) => flow.categoryId === activeCategoryId
  );

  const edges = data.tasks.flatMap((task) =>
    task.dependencies.map((dependencyId) => ({
      from: dependencyId,
      to: task.id,
    }))
  );

  const updateViewport = (updates) => {
    setAppState((prev) => ({
      ...prev,
      viewport: {
        ...prev.viewport,
        ...updates,
      },
    }));
  };

  const updateData = (updater) => {
    setAppState((prev) => ({
      ...prev,
      data: updater(prev.data),
    }));
  };

  const createCategory = () => {
    const name = window.prompt("Category name?");
    if (!name) {
      return;
    }
    const newCategory = {
      id: uuidv4(),
      name,
      color: "#" + Math.floor(Math.random() * 16777215).toString(16),
      visible: true,
    };
    updateData((prev) => ({
      ...prev,
      categories: [...prev.categories, newCategory],
    }));
    setActiveCategoryId(newCategory.id);
  };

  const createFlow = () => {
    if (!activeCategoryId) {
      window.alert("Select a category first.");
      return;
    }
    const title = window.prompt("Flow title?");
    if (!title) {
      return;
    }
    const newFlow = {
      id: uuidv4(),
      title,
      description: "",
      categoryId: activeCategoryId,
    };
    updateData((prev) => ({
      ...prev,
      flows: [...prev.flows, newFlow],
    }));
    setActiveFlowId(newFlow.id);
  };

  const createTask = () => {
    const flowId = activeFlowId ?? flowOptions[0]?.id;
    if (!flowId) {
      window.alert("Create or select a flow first.");
      return;
    }
    const name = window.prompt("Task name?");
    if (!name) {
      return;
    }
    const categoryId = data.flows.find((flow) => flow.id === flowId)?.categoryId;
    const newTask = {
      id: uuidv4(),
      name,
      description: "",
      state: "not_started",
      categoryId,
      flowId,
      dependencies: [],
      x: 120 + Math.random() * 200,
      y: 120 + Math.random() * 200,
    };
    updateData((prev) => ({
      ...prev,
      tasks: [...prev.tasks, newTask],
    }));
    setSelectedTaskId(newTask.id);
  };

  const updateTask = (taskId, updates) => {
    updateData((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task
      ),
    }));
  };

  const deleteTask = (taskId) => {
    updateData((prev) => ({
      ...prev,
      tasks: prev.tasks
        .filter((task) => task.id !== taskId)
        .map((task) => ({
          ...task,
          dependencies: task.dependencies.filter((dep) => dep !== taskId),
        })),
    }));
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  };

  const toggleCategoryVisibility = (categoryId) => {
    updateData((prev) => ({
      ...prev,
      categories: prev.categories.map((category) =>
        category.id === categoryId
          ? { ...category, visible: !category.visible }
          : category
      ),
    }));
  };

  const handleTaskClick = (taskId) => {
    if (linkMode) {
      if (!linkSourceId) {
        setLinkSourceId(taskId);
        return;
      }
      if (linkSourceId === taskId) {
        setLinkSourceId(null);
        return;
      }
      const sourceTask = tasksById[linkSourceId];
      const targetTask = tasksById[taskId];
      if (!sourceTask || !targetTask) {
        return;
      }
      if (targetTask.dependencies.includes(linkSourceId)) {
        setLinkSourceId(null);
        return;
      }
      if (hasCycle(data.tasks, linkSourceId, taskId)) {
        window.alert("That dependency would create a cycle.");
        setLinkSourceId(null);
        return;
      }
      updateTask(taskId, {
        dependencies: [...targetTask.dependencies, linkSourceId],
      });
      setLinkSourceId(null);
      return;
    }

    setSelectedTaskId(taskId);
  };

  const handlePointerDown = (event, task) => {
    event.stopPropagation();
    const svgBounds = svgRef.current.getBoundingClientRect();
    const worldX = (event.clientX - svgBounds.left - viewport.x) / viewport.zoom;
    const worldY = (event.clientY - svgBounds.top - viewport.y) / viewport.zoom;
    setDragState({
      taskId: task.id,
      offsetX: worldX - task.x,
      offsetY: worldY - task.y,
    });
  };

  const handleCanvasPointerDown = (event) => {
    if (event.target.closest(".task-node")) {
      return;
    }
    setSelectedTaskId(null);
    setPanState({
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
  };

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (dragState) {
        const svgBounds = svgRef.current.getBoundingClientRect();
        const worldX =
          (event.clientX - svgBounds.left - viewport.x) / viewport.zoom;
        const worldY =
          (event.clientY - svgBounds.top - viewport.y) / viewport.zoom;
        updateTask(dragState.taskId, {
          x: worldX - dragState.offsetX,
          y: worldY - dragState.offsetY,
        });
      }
      if (panState) {
        updateViewport({
          x: panState.originX + (event.clientX - panState.startX),
          y: panState.originY + (event.clientY - panState.startY),
        });
      }
    };

    const handlePointerUp = () => {
      setDragState(null);
      setPanState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, panState, viewport.x, viewport.y, viewport.zoom]);

  const handleWheel = (event) => {
    event.preventDefault();
    const zoomDelta = event.deltaY < 0 ? 0.1 : -0.1;
    const nextZoom = Math.min(2.5, Math.max(0.4, viewport.zoom + zoomDelta));
    updateViewport({ zoom: nextZoom });
  };

  const selectedTask = selectedTaskId ? tasksById[selectedTaskId] : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>FlowTasks MVP</h1>
          <p>Visual task dependencies with local persistence.</p>
        </header>

        <section>
          <div className="section-header">
            <h2>Categories</h2>
            <button onClick={createCategory}>Add</button>
          </div>
          <ul className="list">
            {data.categories.map((category) => (
              <li key={category.id}>
                <button
                  className={
                    activeCategoryId === category.id ? "active" : undefined
                  }
                  onClick={() => {
                    setActiveCategoryId(category.id);
                    setActiveFlowId(null);
                  }}
                >
                  <span
                    className="color-dot"
                    style={{ background: category.color }}
                  />
                  {category.name}
                </button>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={category.visible}
                    onChange={() => toggleCategoryVisibility(category.id)}
                  />
                  <span>{category.visible ? "Visible" : "Hidden"}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="section-header">
            <h2>Flows</h2>
            <button onClick={createFlow}>Add</button>
          </div>
          <ul className="list">
            {flowOptions.map((flow) => (
              <li key={flow.id}>
                <button
                  className={activeFlowId === flow.id ? "active" : undefined}
                  onClick={() => setActiveFlowId(flow.id)}
                >
                  {flow.title}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="section-header">
            <h2>Tasks</h2>
            <button onClick={createTask}>Add</button>
          </div>
          <div className="controls">
            <button
              className={linkMode ? "active" : undefined}
              onClick={() => {
                setLinkMode((prev) => !prev);
                setLinkSourceId(null);
              }}
            >
              {linkMode ? "Linking: On" : "Linking: Off"}
            </button>
          </div>
          <p className="hint">
            {linkMode
              ? linkSourceId
                ? "Select a target task to create a dependency."
                : "Select a source task to start a dependency."
              : "Click a task to inspect and edit."}
          </p>
        </section>

        {selectedTask && (
          <section>
            <div className="section-header">
              <h2>Inspector</h2>
              <button onClick={() => deleteTask(selectedTask.id)}>Delete</button>
            </div>
            <label>
              Name
              <input
                value={selectedTask.name}
                onChange={(event) =>
                  updateTask(selectedTask.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              State
              <select
                value={selectedTask.state}
                onChange={(event) =>
                  updateTask(selectedTask.id, { state: event.target.value })
                }
              >
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </label>
            <label>
              Description
              <textarea
                value={selectedTask.description}
                onChange={(event) =>
                  updateTask(selectedTask.id, {
                    description: event.target.value,
                  })
                }
              />
            </label>
          </section>
        )}
      </aside>

      <main className="canvas-wrapper">
        <div className="toolbar">
          <span>Zoom: {(viewport.zoom * 100).toFixed(0)}%</span>
          <button onClick={() => updateViewport(defaultViewport)}>
            Reset View
          </button>
        </div>
        <svg
          className="canvas"
          ref={svgRef}
          onPointerDown={handleCanvasPointerDown}
          onWheel={handleWheel}
        >
          <rect width="100%" height="100%" fill="#0f1118" />
          <g
            transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}
          >
            {edges.map((edge) => {
              const from = tasksById[edge.from];
              const to = tasksById[edge.to];
              if (!from || !to) {
                return null;
              }
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={from.x + 60}
                  y1={from.y + 24}
                  x2={to.x}
                  y2={to.y + 24}
                  stroke="#6e738a"
                  strokeWidth="2"
                  markerEnd="url(#arrow)"
                />
              );
            })}
            <defs>
              <marker
                id="arrow"
                markerWidth="10"
                markerHeight="10"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L6,3 z" fill="#6e738a" />
              </marker>
            </defs>

            {filteredTasks.map((task) => {
              const category = getCategoryById(data.categories, task.categoryId);
              const blocked = isBlocked(task, tasksById);
              return (
                <g
                  key={task.id}
                  className={`task-node ${task.state} ${
                    blocked ? "blocked" : ""
                  } ${linkSourceId === task.id ? "link-source" : ""}`}
                  transform={`translate(${task.x}, ${task.y})`}
                  onPointerDown={(event) => handlePointerDown(event, task)}
                  onDoubleClick={() =>
                    updateTask(task.id, { state: nextState(task.state) })
                  }
                  onClick={() => handleTaskClick(task.id)}
                >
                  <rect width="120" height="48" rx="10" />
                  <text x="12" y="24" dominantBaseline="middle">
                    {task.name}
                  </text>
                  <text x="12" y="40" className="meta">
                    {category?.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </main>
    </div>
  );
}
