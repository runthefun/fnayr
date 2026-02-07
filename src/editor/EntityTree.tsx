import { useEditor, useSelectedEntity, useEntities } from "./useEditor";

export function EntityTree() {
  const { world, hierarchy, store } = useEditor();
  const selectedEntity = useSelectedEntity();
  // Subscribe to entity changes so tree re-renders when entities change
  useEntities();

  const entities: number[] = [];
  world.forEachEntity((e) => entities.push(e));

  // Build root entities (no parent)
  const roots = entities.filter((e) => hierarchy.getParent(e) === undefined);

  function handleCreateEntity() {
    const entity = world.createEntity();
    world.setComponent(entity, "Transform3D", {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    store.selectEntity(entity);
  }

  function handleDeleteEntity(entity: number) {
    world.destroyEntity(entity);
  }

  function renderEntity(entity: number, depth: number) {
    const children = hierarchy.getChildren(entity);
    const isSelected = entity === selectedEntity;
    const components: string[] = [];
    for (const type of Object.keys(world.registry) as Array<keyof typeof world.registry>) {
      if (world.hasComponent(entity, type)) {
        components.push(type);
      }
    }

    return (
      <div key={entity}>
        <div
          className={`w-full text-left px-2 py-1 flex items-center gap-1.5 hover:bg-surface ${
            isSelected ? "bg-selected" : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <button
            onClick={() => store.selectEntity(entity)}
            className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
          >
            <span className="text-muted text-[10px] shrink-0">
              {entity}
            </span>
            <span className="truncate">
              Entity {entity}
            </span>
          </button>
          <span className="flex gap-0.5 shrink-0 items-center">
            {components.map((c) => (
              <span
                key={c}
                className="bg-subtle text-muted px-1 rounded text-[9px]"
              >
                {c}
              </span>
            ))}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteEntity(entity);
              }}
              className="text-muted hover:text-primary text-[10px] ml-1 cursor-pointer"
              title="Delete entity"
            >
              x
            </button>
          </span>
        </div>
        {children.map((child) => renderEntity(child as number, depth + 1))}
      </div>
    );
  }

  return (
    <div>
      <div className="px-2 py-1.5 text-muted font-medium uppercase tracking-wider text-[10px] border-b border-subtle flex items-center justify-between">
        <span>Entities</span>
        <button
          onClick={handleCreateEntity}
          className="text-muted hover:text-primary text-sm leading-none cursor-pointer"
          title="Create entity"
        >
          +
        </button>
      </div>
      {roots.map((entity) => renderEntity(entity, 0))}
    </div>
  );
}
