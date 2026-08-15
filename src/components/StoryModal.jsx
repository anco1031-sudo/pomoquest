export default function StoryModal({ story, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal story-modal" onClick={(e) => e.stopPropagation()}>
        <div className="story-icon">📖</div>
        <h2 className="story-title">เรื่องราวการผจญภัย</h2>
        <p className="story-text">{story.detail}</p>
        <button className="btn btn-primary btn-big" onClick={onClose}>รับทราบ</button>
      </div>
    </div>
  );
}
