import { useLocalization } from "../context/LocalizationContext";
import { GridIcon, ListIcon } from "./AppIcons";

export function CatalogViewToggle({
  value,
  onChange
}: {
  value: "tile" | "list";
  onChange: (nextValue: "tile" | "list") => void;
}) {
  const { t } = useLocalization();

  return (
    <div aria-label="Catalog view mode" className="catalog-view-toggle" role="group">
      <button
        aria-label={t("catalog.view.tile", "Tile view")}
        className={value === "tile" ? "catalog-view-button is-active" : "catalog-view-button"}
        onClick={() => onChange("tile")}
        title={t("catalog.view.tile", "Tile view")}
        type="button"
      >
        <GridIcon size={15} />
      </button>
      <button
        aria-label={t("catalog.view.list", "List view")}
        className={value === "list" ? "catalog-view-button is-active" : "catalog-view-button"}
        onClick={() => onChange("list")}
        title={t("catalog.view.list", "List view")}
        type="button"
      >
        <ListIcon size={15} />
      </button>
    </div>
  );
}
