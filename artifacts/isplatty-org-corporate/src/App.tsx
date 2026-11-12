function App() {
  return (
    <main className="h-screen w-full overflow-hidden bg-white">
      <iframe
        title="ISPLATTY.ORG corporate website"
        src={`${import.meta.env.BASE_URL}site/index.html`}
        className="h-full w-full border-0"
      />
    </main>
  );
}

export default App;
