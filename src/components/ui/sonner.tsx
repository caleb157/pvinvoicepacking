import { Toaster as Sonner } from "sonner";

const Toaster = () => {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
};

export { Toaster };
