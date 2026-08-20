export default function ErrorBanner({ message, details }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <strong>{message}</strong>
      {Array.isArray(details) && details.length > 0 && (
        <ul>
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
